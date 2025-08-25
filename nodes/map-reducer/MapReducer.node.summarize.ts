import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { PromptTemplate } from '@langchain/core/prompts';
import { getLogger } from './utils/logger';
import {
	countTokens,
	usedTokensFromMessage,
	withRetry,
	hierarchicalReduce,
	makeQueue,
} from './utils/helper-functions';
import { getNodeProperties } from './utils/getNodeProperties';
import { IExecuteFunctions } from 'n8n-workflow';

/**
 * Typ-Definition für Dokument-Objekte.
 *
 * Definiert die Struktur eines Dokuments mit Inhalt und erweiterten Metadaten.
 * Wird im Map-Reduce-Prozess für die Verarbeitung von Text-Chunks verwendet.
 */
type Doc = { pageContent: string; metadata: { chunk: number; tokenCount: number } };

/**
 * Führt eine vollständige Map-Reduce-Zusammenfassung von Dokumenten durch.
 *
 * Implementiert den kompletten Map-Reduce-Workflow:
 * 1. Map-Phase: Jedes Dokument wird einzeln zusammengefasst
 * 2. Reduce-Phase: Alle Teilzusammenfassungen werden hierarchisch kombiniert
 *
 * Die Funktion berücksichtigt Token-Budgets und Rate-Limits für API-Aufrufe.
 * Sie wartet automatisch, wenn Token-Limits erreicht werden.
 *
 * @param docs - Array von Dokumenten, die zusammengefasst werden sollen
 * @param model - Das ChatOpenAI-Modell für die Zusammenfassung
 * @param mapPrompt - PromptTemplate für die Map-Phase
 * @param combinePrompt - PromptTemplate für die Combine-Phase
 * @param config - Konfiguration für die Zusammenfassung
 * @param encodingModel - Encoding-Modell für Token-Zählung
 * @returns Promise mit der finalen HTML-formatierten Zusammenfassung
 *
 * @example
 * ```typescript
 * const docs = await docsFromPlainText(longText);
 * const model = makeAzureModel();
 *
 * const summary = await summarizeWithQueue(docs, model, mapPrompt, combinePrompt, config, 'o200k');
 * console.log("Finale Zusammenfassung:", summary);
 * ```
 */
export async function summarizeWithQueue(
	executeFunctionsContext: IExecuteFunctions,
	docs: Doc[],
	model: BaseLanguageModel,
	mapPrompt: PromptTemplate,
	combinePrompt: PromptTemplate,
): Promise<string> {
	const logger = getLogger('summarizeWithQueue');
	logger.info(`🚦 Starting MAP-REDUCE with ${docs.length} documents`);

	if (!docs || docs.length === 0) {
		throw new Error('No documents provided for summarization');
	}

	const { SummarizeCfg: config, encodingModel } = getNodeProperties(executeFunctionsContext);

	// Log Token-Verteilung der Input-Dokumente
	const totalInputTokens = docs.reduce((sum, doc) => sum + doc.metadata.tokenCount, 0);
	const avgTokensPerDoc = Math.round(totalInputTokens / docs.length);
	logger.debug(
		`📊 Input token analysis: total=${totalInputTokens}, avg=${avgTokensPerDoc}, max=${Math.max(...docs.map((d) => d.metadata.tokenCount))}`,
	);

	const { queue, tokenTracker } = makeQueue(config);
	const partials: string[] = [];

	try {
		// MAP Phase - Process each document
		logger.debug('📋 Starting MAP phase...');
		for (let i = 0; i < docs.length; i++) {
			const doc = docs[i];

			try {
				if (!doc?.pageContent) {
					logger.warn(`⚠️ Skipping document ${i + 1}: no pageContent found`);
					continue;
				}

				const prompt = await mapPrompt.format({ text: doc.pageContent });
				const promptTokens = countTokens(prompt, encodingModel);
				const estWeight = promptTokens + config.MAP_OUT_MAX;

				logger.debug(
					`📝 MAP chunk ${doc.metadata.chunk + 1}: input=${doc.metadata.tokenCount} tokens, prompt=${promptTokens} tokens, estimated=${estWeight} tokens`,
				);

				// Token budget validation mit präzisen Werten
				if (estWeight > config.TOKENS_PER_MINUTE) {
					throw new Error(
						`MAP operation token estimate (${estWeight}) exceeds TPM limit (${config.TOKENS_PER_MINUTE})`,
					);
				}

				// Token budget waiting with timeout
				const timeoutMs = config.TOKEN_BUDGET_TIMEOUT;
				const startTime = Date.now();
				while (!tokenTracker.canUseTokens(estWeight)) {
					if (Date.now() - startTime > timeoutMs) {
						const errorMsg = `Token budget timeout after ${config.TOKEN_BUDGET_TIMEOUT / 1000} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`;
						logger.error(`[MAP chunk ${doc.metadata.chunk + 1}] ${errorMsg}`);
						throw new Error(errorMsg);
					}
					logger.info(
						`[MAP chunk ${doc.metadata.chunk + 1}] Waiting for token budget... (need ${estWeight}, have ${tokenTracker.getRemainingTokens()})`,
					);
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}

				logger.info(`🧮 MAP chunk ${doc.metadata.chunk + 1} (est ~${estWeight} tokens)`);

				// Execute MAP operation with retry and error handling
				const partial = (await queue.add(async () =>
					withRetry(async () => {
						try {
							const res = await model.invoke(prompt, {
								maxTokens: config.MAP_OUT_MAX,
								temperature: config.TEMPERATURE,
							} as any);

							if (!res?.content) {
								throw new Error(`Empty response from model for document ${doc.metadata.chunk + 1}`);
							}

							const actualTokens = usedTokensFromMessage(res) || estWeight;
							tokenTracker.useTokens(actualTokens);
							logger.debug(
								`✅ [MAP chunk ${doc.metadata.chunk + 1}] Used ${actualTokens} tokens - completed successfully`,
							);

							return (res.content as string).trim();
						} catch (error) {
							logger.error(
								`Model invocation failed for document ${doc.metadata.chunk + 1}:`,
								error,
							);
							throw error;
						}
					}),
				)) as string;

				if (partial && partial.length > 0) {
					partials.push(partial);
				} else {
					logger.warn(`⚠️ MAP chunk ${doc.metadata.chunk + 1} returned empty result`);
				}
			} catch (error) {
				logger.error(`Failed to process document ${doc.metadata.chunk + 1}:`, error);
				// Continue with other documents instead of failing completely
				if (error instanceof Error && error.message.includes('Token budget timeout')) {
					throw error; // Re-throw timeout errors as they indicate systemic issues
				}
				// For other errors, log and continue
				logger.warn(
					`⚠️ Skipping document ${doc.metadata.chunk + 1} due to error, continuing with remaining documents`,
				);
			}
		}

		if (partials.length === 0) {
			throw new Error('No documents were successfully processed in MAP phase');
		}

		logger.info(`✅ MAP phase completed: ${partials.length}/${docs.length} documents processed`);
	} catch (error) {
		logger.error('MAP phase failed:', error);
		throw new Error(
			`MAP phase failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}

	// REDUCE Phase - Hierarchical reduction
	try {
		const reduceJob = async (joined: string): Promise<string> => {
			if (!joined || joined.trim().length === 0) {
				throw new Error('Empty text provided for reduce operation');
			}

			const inputTokens = countTokens(joined, encodingModel);
			const prompt = await combinePrompt.format({ text: joined });
			const promptTokens = countTokens(prompt, encodingModel);
			const estWeight = promptTokens + config.REDUCE_OUT_MAX;

			logger.debug(
				`📝 REDUCE: input=${inputTokens} tokens, prompt=${promptTokens} tokens, estimated=${estWeight} tokens`,
			);

			// Token budget validation
			if (estWeight > config.TOKENS_PER_MINUTE) {
				throw new Error(
					`REDUCE operation token estimate (${estWeight}) exceeds TPM limit (${config.TOKENS_PER_MINUTE}). Consider reducing REDUCE_OUT_MAX or input size.`,
				);
			}

			try {
				// Token budget waiting with timeout
				const timeoutMs = config.TOKEN_BUDGET_TIMEOUT;
				const startTime = Date.now();
				while (!tokenTracker.canUseTokens(estWeight)) {
					if (Date.now() - startTime > timeoutMs) {
						const errorMsg = `Token budget timeout after ${config.TOKEN_BUDGET_TIMEOUT / 1000} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`;
						logger.error(`[REDUCE] ${errorMsg}`);
						throw new Error(errorMsg);
					}
					logger.info(
						`[REDUCE] Waiting for token budget... (need ${estWeight}, have ${tokenTracker.getRemainingTokens()})`,
					);
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}

				return (await queue.add(async () =>
					withRetry(async () => {
						logger.info(`🧮 REDUCE (est ~${estWeight} tokens)`);

						try {
							const res = await model.invoke(prompt, {
								maxTokens: config.REDUCE_OUT_MAX,
								temperature: config.TEMPERATURE,
							} as any);

							if (!res?.content) {
								throw new Error('Empty response from model during reduce operation');
							}

							const actualTokens = usedTokensFromMessage(res) || estWeight;
							tokenTracker.useTokens(actualTokens);
							logger.info(`✅ [REDUCE] Used ${actualTokens} tokens - completed successfully`);

							return (res.content as string).trim();
						} catch (error) {
							logger.error('Model invocation failed during reduce operation:', error);
							throw error;
						}
					}),
				)) as string;
			} catch (error) {
				logger.error('Reduce job failed:', error);
				throw new Error(
					`Reduce operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		};

		logger.info(`🔄 Starting REDUCE phase...`);
		const final = await hierarchicalReduce(partials, reduceJob, config.HIERARCHY_GROUP_SIZE);

		if (!final || final.trim().length === 0) {
			throw new Error('Hierarchical reduce returned empty result');
		}

		logger.info('🎉 MAP-REDUCE completed successfully');
		return final.trim();
	} catch (error) {
		logger.error('REDUCE phase failed:', error);
		throw new Error(
			`REDUCE phase failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}
