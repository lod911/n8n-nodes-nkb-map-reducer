import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { PromptTemplate } from '@langchain/core/prompts';
import PQueue from 'p-queue';
import { getLogger } from './utils/logger';
import {
	countTokens,
	usedTokensFromMessage,
	withRetry,
	hierarchicalReduce,
	TokenBudgetTracker,
} from './utils/helper-functions';
import { SummarizeCfg } from './utils/getNodeProperties';

/**
 * Typ-Definition für Dokument-Objekte.
 *
 * Definiert die Struktur eines Dokuments mit Inhalt und optionalen Metadaten.
 * Wird im Map-Reduce-Prozess für die Verarbeitung von Text-Chunks verwendet.
 */
type Doc = { pageContent: string; metadata?: any };

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
 * @param queue - PQueue für Rate-Limiting der API-Aufrufe
 * @param tokenTracker - Token-Budget-Tracker für Token-Management
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
 * const { queue, tokenTracker } = makeQueue();
 *
 * const summary = await summarizeWithQueue(docs, model, queue, tokenTracker, mapPrompt, combinePrompt, config, 'o200k');
 * console.log("Finale Zusammenfassung:", summary);
 * ```
 */
export async function summarizeWithQueue(
	docs: Doc[],
	model: BaseLanguageModel,
	queue: PQueue,
	tokenTracker: TokenBudgetTracker,
	mapPrompt: PromptTemplate,
	combinePrompt: PromptTemplate,
	config: SummarizeCfg,
	encodingModel: string,
): Promise<string> {
	const logger = getLogger('summarizeWithQueue');
	logger.info(`🚦 Start Map-Reduce (docs=${docs.length})`);

	const partials: string[] = [];
	for (let i = 0; i < docs.length; i++) {
		const doc = docs[i];
		const prompt = await mapPrompt.format({ text: doc.pageContent });
		const estWeight = countTokens(prompt, encodingModel) + config.MAP_OUT_MAX;

		const timeoutMs = config.TOKEN_BUDGET_TIMEOUT;
		const startTime = Date.now();
		while (!tokenTracker.canUseTokens(estWeight)) {
			if (Date.now() - startTime > timeoutMs) {
				logger.error(
					`Token budget timeout after ${
						timeoutMs / 1000
					} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`,
				);
				throw new Error(
					`Token budget timeout after ${
						timeoutMs / 1000
					} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`,
				);
			}
			logger.info(
				`⏳ Waiting for token budget... (need ${estWeight}, have ${tokenTracker.getRemainingTokens()})`,
			);
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		const partial = (await queue.add(async () =>
			withRetry(async () => {
				logger.info(`🧩 MAP ${i + 1}/${docs.length} (est ~${estWeight} tok)`);
				const res = await model.invoke(prompt, {
					maxTokens: config.MAP_OUT_MAX,
					temperature: 0.2,
				} as any);

				const used = usedTokensFromMessage(res);
				if (used) {
					tokenTracker.useTokens(used);
					logger.debug(`   used ${used} tokens`);
				} else {
					tokenTracker.useTokens(estWeight);
				}
				return (res?.content as string) ?? '';
			}),
		)) as string;

		partials.push(partial);
	}

	const reduceJob = async (joined: string): Promise<string> => {
		const prompt = await combinePrompt.format({ text: joined });
		const estWeight = countTokens(prompt, encodingModel) + config.REDUCE_OUT_MAX;

		const timeoutMs = config.TOKEN_BUDGET_TIMEOUT;
		const startTime = Date.now();
		while (!tokenTracker.canUseTokens(estWeight)) {
			if (Date.now() - startTime > timeoutMs) {
				logger.error(
					`Token budget timeout after ${
						timeoutMs / 1000
					} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`,
				);
				throw new Error(
					`Token budget timeout after ${
						timeoutMs / 1000
					} seconds: need ${estWeight}, have ${tokenTracker.getRemainingTokens()}`,
				);
			}
			logger.info(
				`Waiting for token budget for reduce... (need ${estWeight}, have ${tokenTracker.getRemainingTokens()})`,
			);
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		return (await queue.add(async () =>
			withRetry(async () => {
				logger.info(`🧮 REDUCE (est ~${estWeight} tok)`);
				const res = await model.invoke(prompt, {
					maxTokens: config.REDUCE_OUT_MAX,
					temperature: 0.2,
				} as any);

				const used = usedTokensFromMessage(res);
				if (used) {
					tokenTracker.useTokens(used);
					logger.debug(`   used ${used} tokens`);
				} else {
					tokenTracker.useTokens(estWeight);
				}
				return (res?.content as string) ?? '';
			}),
		)) as string;
	};

	const final = await hierarchicalReduce(partials, reduceJob, config.HIERARCHY_GROUP_SIZE);

	logger.info('✅ Summarization fertig');
	return final.trim();
}
