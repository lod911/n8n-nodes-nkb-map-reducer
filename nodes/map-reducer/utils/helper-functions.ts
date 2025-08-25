import { encode as encode_o200k_base } from 'gpt-tokenizer/cjs/encoding/o200k_base';
import { encode as encode_cl100k_base } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getLogger } from './logger';
import { getNodeProperties, SummarizeCfg } from './getNodeProperties';
import { IExecuteFunctions } from 'n8n-workflow';

/**
 * Zählt die Anzahl der Tokens in einem gegebenen Text.
 *
 * Verwendet den gpt-tokenizer, um die exakte Anzahl der Tokens zu bestimmen,
 * die ein Text verbraucht. Dies ist wichtig für das Token-Budget-Management
 * bei API-Aufrufen an OpenAI-Services.
 *
 * @param text - Der Text, dessen Tokens gezählt werden sollen
 * @param encodingModel - Das zu verwendende Encoding-Modell ('o200k' oder 'cl100k')
 * @returns Die Anzahl der Tokens im Text
 *
 * @example
 * ```typescript
 * const tokenCount = countTokens("Hello, world!", 'o200k');
 * console.log(tokenCount); // z.B. 4
 * ```
 */
export function countTokens(text: string, encodingModel: string): number {
	const encode = encodingModel === 'o200k' ? encode_o200k_base : encode_cl100k_base;
	return encode(text).length;
}

/**
 * Token-Budget-Tracker zur Überwachung und Kontrolle des Token-Verbrauchs.
 *
 * Diese Klasse implementiert ein Token-Budget-System, das sicherstellt, dass
 * die konfigurierten Token-Limits pro Minute (TPM) eingehalten werden.
 * Das System verwendet ein gleitendes Zeitfenster von 60 Sekunden zur
 * Überwachung des Token-Verbrauchs.
 *
 * @example
 * ```typescript
 * const tracker = new TokenBudgetTracker(config);
 *
 * if (tracker.canUseTokens(1000)) {
 *   // API-Aufruf durchführen
 *   tracker.useTokens(950); // Tatsächlich verbrauchte Tokens
 * }
 * ```
 */
export class TokenBudgetTracker {
	private usedTokens = 0;
	private windowStart = Date.now();
	private readonly windowMs: number;
	private readonly tokensPerMinute: number;

	constructor(config: SummarizeCfg) {
		this.windowMs = config.TOKEN_BUDGET_WINDOWS;
		this.tokensPerMinute = config.TOKENS_PER_MINUTE;
	}

	/**
	 * Prüft, ob die angegebene Anzahl von Tokens verwendet werden kann.
	 *
	 * Überprüft, ob der geschätzte Token-Verbrauch innerhalb des konfigurierten
	 * Token-Budgets (TPM) liegt. Berücksichtigt dabei das gleitende Zeitfenster.
	 *
	 * @param estimatedTokens - Die geschätzte Anzahl der zu verwendenden Tokens
	 * @returns true, wenn die Tokens verwendet werden können, sonst false
	 */
	canUseTokens(estimatedTokens: number): boolean {
		this.resetIfNeeded();
		return this.usedTokens + estimatedTokens <= this.tokensPerMinute;
	}

	/**
	 * Registriert den tatsächlichen Token-Verbrauch.
	 *
	 * Fügt die tatsächlich verbrauchten Tokens zum laufenden Budget hinzu.
	 * Diese Methode sollte nach jedem API-Aufruf mit der realen Token-Anzahl
	 * aufgerufen werden.
	 *
	 * @param actualTokens - Die tatsächlich verbrauchten Tokens
	 */
	useTokens(actualTokens: number): void {
		this.resetIfNeeded();
		this.usedTokens += actualTokens;
	}

	/**
	 * Setzt den Token-Zähler zurück, wenn das Zeitfenster abgelaufen ist.
	 *
	 * Private Methode, die automatisch aufgerufen wird, um das gleitende
	 * Zeitfenster zu verwalten. Setzt bei Bedarf die verwendeten Tokens
	 * und den Zeitfenster-Start zurück.
	 *
	 * @private
	 */
	private resetIfNeeded(): void {
		const now = Date.now();
		if (now - this.windowStart >= this.windowMs) {
			this.usedTokens = 0;
			this.windowStart = now;
		}
	}

	/**
	 * Gibt die Anzahl der noch verfügbaren Tokens im aktuellen Zeitfenster zurück.
	 *
	 * Berechnet die verbleibenden Tokens basierend auf dem konfigurierten
	 * Token-Limit (TPM) und dem bereits verbrauchten Budget.
	 *
	 * @returns Die Anzahl der noch verfügbaren Tokens (mindestens 0)
	 */
	getRemainingTokens(): number {
		this.resetIfNeeded();
		return Math.max(0, this.tokensPerMinute - this.usedTokens);
	}
}

/**
 * Erstellt eine PQueue-Instanz zur Steuerung von gleichzeitigen Tasks und zur Einhaltung von API-Rate-Limits.
 * Zusätzlich wird ein TokenBudgetTracker initialisiert, um den Tokenverbrauch im Auge zu behalten.
 *
 * @param config - Konfigurationsobjekt vom Typ {@link SummarizeCfg}.
 *
 * ### Parameter (aus PQueue):
 *
 * #### `concurrency` (`config.QUEUE_CONCURRENCY`)
 * - **Bedeutung:** Maximale Anzahl an Tasks, die gleichzeitig ausgeführt werden.
 * - **Auswirkung:**
 *   - Höherer Wert → mehr Durchsatz, aber höhere Last.
 *   - Niedriger Wert → geringere Last, dafür längere Gesamtdauer.
 *
 * #### `interval` (`config.QUEUE_INTERVAL`)
 * - **Bedeutung:** Zeitfenster in Millisekunden, über das die Anzahl der gestarteten Tasks gezählt wird.
 * - **Auswirkung:** Steuert die Zeitbasis für das Rate-Limit.
 * - **Beispiel:** `60_000` für ein 1-Minuten-Zeitfenster.
 *
 * #### `intervalCap` (`config.REQUESTS_PER_MINUTE`)
 * - **Bedeutung:** Maximale Anzahl an Tasks, die innerhalb eines `interval`-Zeitfensters gestartet werden dürfen.
 * - **Auswirkung:** Schützt vor API-Rate-Limits, pausiert automatisch bis zum nächsten Intervall, falls erreicht.
 * - **Beispiel:** Bei `20` und `interval = 60_000` → maximal 20 Starts pro Minute.
 *
 * ### Zusammenspiel der Parameter:
 * - `concurrency` limitiert **gleichzeitige** Ausführungen.
 * - `interval` + `intervalCap` limitieren **Frequenz** der Ausführungen pro Zeitfenster.
 * - Das härteste Limit gewinnt: Ist `concurrency` > `intervalCap`, limitiert `intervalCap`.
 *   Ist `intervalCap` sehr hoch, limitiert `concurrency`.
 *
 * @returns Ein Objekt mit:
 * - `queue`: Die konfigurierte PQueue-Instanz.
 * - `tokenTracker`: Instanz von {@link TokenBudgetTracker}, um den Tokenverbrauch zu überwachen.
 *
 * ### Beispiel:
 * ```ts
 * const { queue, tokenTracker } = makeQueue({
 *   QUEUE_CONCURRENCY: 3,
 *   QUEUE_INTERVAL: 60_000,
 *   REQUESTS_PER_MINUTE: 10
 * });
 *
 * queue.add(() => doSomethingAsync());
 * ```
 */
export function makeQueue(config: SummarizeCfg) {
	const queue = new PQueue({
		concurrency: config.QUEUE_CONCURRENCY,
		interval: config.QUEUE_INTERVAL,
		intervalCap: config.REQUESTS_PER_MINUTE,
	});

	const tokenTracker = new TokenBudgetTracker(config);
	return { queue, tokenTracker };
}

/**
 * Führt eine Funktion mit automatischen Wiederholungsversuchen aus.
 *
 * Diese generische Retry-Funktion behandelt verschiedene Arten von Fehlern
 * mit spezifischen Retry-Strategien:
 * - HTTP 429 (Rate Limit): Berücksichtigt Retry-After Header oder exponential backoff
 * - HTTP 5xx (Server Errors): Exponential backoff mit Jitter
 * - Andere Fehler: Werden sofort weitergegeben
 *
 * @template T - Der Rückgabetyp der auszuführenden Funktion
 * @param fn - Die auszuführende asynchrone Funktion
 * @param maxRetries - Maximale Anzahl der Wiederholungsversuche (Standard: 6)
 * @returns Promise mit dem Ergebnis der erfolgreichen Ausführung
 *
 * @throws Wirft den ursprünglichen Fehler weiter, wenn alle Versuche fehlschlagen
 *
 * @example
 * ```typescript
 * const result = await withRetry(async () => {
 *   return await apiCall();
 * }, 3);
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 6): Promise<T> {
	const logger = getLogger('withRetry');

	return pRetry(fn, {
		retries: maxRetries,
		onFailedAttempt: async (error) => {
			const status = (error as any)?.status ?? (error as any)?.response?.status;
			const retryAfter = Number((error as any)?.response?.headers?.['retry-after']);

			if (status === 429) {
				const delay = !isNaN(retryAfter)
					? retryAfter * 1000
					: Math.min(2 ** error.attemptNumber * 1000, 8000);
				logger.warn(`429 received, retry ${error.attemptNumber}/${maxRetries + 1} in ${delay} ms`);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return;
			}

			if (status >= 500) {
				logger.warn(`Server error ${status}, retry ${error.attemptNumber}/${maxRetries + 1}`);
				const delay = Math.min(2 ** error.attemptNumber * 1000, 8000);
				await new Promise((resolve) => setTimeout(resolve, delay));
				return;
			}

			throw error;
		},
	});
}

/**
 * Extrahiert Token-Verbrauchsinformationen aus einer API-Antwort.
 *
 * Analysiert die Metadaten einer API-Antwort und extrahiert die Anzahl
 * der verwendeten Tokens. Unterstützt verschiedene Formate der Usage-Metadaten:
 * - Separate input_tokens und output_tokens
 * - Kombinierte total_tokens
 *
 * @param msg - Die API-Antwort-Nachricht mit potentiellen Usage-Metadaten
 * @returns Die Anzahl der verwendeten Tokens oder null, wenn nicht verfügbar
 *
 * @example
 * ```typescript
 * const response = await model.invoke(prompt);
 * const tokens = usedTokensFromMessage(response);
 * if (tokens) {
 *   console.log(`Verbrauchte Tokens: ${tokens}`);
 * }
 * ```
 */
export function usedTokensFromMessage(msg: any): number | null {
	const logger = getLogger('usedTokensFromMessage');
	const usageMetadata = msg?.usage_metadata;
	logger.debug(`Usage metadata: ${JSON.stringify(usageMetadata)}`);
	if (!usageMetadata) return null;

	const inputTokens = usageMetadata.input_tokens;
	const outputTokens = usageMetadata.output_tokens;

	if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
		return inputTokens + outputTokens;
	}

	const totalTokens = usageMetadata.total_tokens;
	return typeof totalTokens === 'number' ? totalTokens : null;
}

/**
 * Führt eine hierarchische Reduzierung von Texten durch.
 *
 * Implementiert eine Baum-basierte Reduzierungsstrategie, bei der Texte
 * in Gruppen aufgeteilt und schrittweise zusammengefasst werden. Wenn die
 * Anzahl der Texte die Gruppengröße überschreitet, werden sie in kleinere
 * Gruppen aufgeteilt, verarbeitet und das Ergebnis rekursiv weiter reduziert.
 *
 * @param texts - Array von Texten, die reduziert werden sollen
 * @param reduceJob - Funktion, die einen zusammengefügten Text reduziert
 * @param groupSize - Maximale Gruppengröße pro Reduzierungsschritt
 * @returns Promise mit dem final reduzierten Text
 *
 * @example
 * ```typescript
 * const summaries = ["Zusammenfassung 1", "Zusammenfassung 2", ...];
 * const final = await hierarchicalReduce(
 *   summaries,
 *   async (joined) => await summarizeText(joined),
 *   4
 * );
 * ```
 */
export async function hierarchicalReduce(
	texts: string[],
	reduceJob: (joined: string) => Promise<string>,
	groupSize: number,
): Promise<string> {
	const logger = getLogger('hierarchicalReduce');

	logger.debug(`Starting hierarchical reduce with ${texts.length} texts, groupSize: ${groupSize}`);
	logger.trace(`Text lengths: [${texts.map((t) => t.length).join(', ')}]`);

	if (texts.length <= groupSize) {
		logger.debug(`Final reduction step: ${texts.length} texts fit in one group`);
		const joinedText = texts.join('\n\n---\n\n');
		logger.trace(`Joined text length: ${joinedText.length} characters`);

		const result = await reduceJob(joinedText);
		logger.debug(`Final reduction completed, result length: ${result.length} characters`);
		return result;
	}

	const groups: string[][] = [];
	for (let i = 0; i < texts.length; i += groupSize) {
		groups.push(texts.slice(i, i + groupSize));
	}

	logger.debug(`Created ${groups.length} groups for parallel processing`);
	logger.trace(`Group sizes: [${groups.map((g) => g.length).join(', ')}]`);

	const level = await Promise.all(
		groups.map(async (g, index) => {
			const joinedText = g.join('\n\n---\n\n');
			logger.trace(
				`Processing group ${index + 1}/${groups.length}, joined length: ${joinedText.length} characters`,
			);

			const result = await reduceJob(joinedText);
			logger.trace(`Group ${index + 1} completed, result length: ${result.length} characters`);
			return result;
		}),
	);

	logger.debug(`Level completed, proceeding with recursive reduction of ${level.length} results`);
	return hierarchicalReduce(level, reduceJob, groupSize);
}

/**
 * Konvertiert einen langen Text in ein Array von Dokumenten mit präziser Token-Berechnung.
 *
 * Teilt einen langen Text mit Hilfe des Token-bewussten Splitters in
 * kleinere Chunks auf und erstellt daraus ein Array von Dokumenten-Objekten.
 * Jedes Dokument enthält den Text-Inhalt, Metadaten mit Chunk-Nummer und
 * die exakte Token-Anzahl für bessere Budgetplanung.
 *
 * @param longText - Der zu teilende lange Text
 * @returns Promise mit einem Array von Dokumenten-Objekten mit Token-Informationen
 *
 * @example
 * ```typescript
 * const docs = await docsFromPlainText("Sehr langer Text mit vielen Nachrichten...");
 * console.log(`Aufgeteilt in ${docs.length} Chunks`);
 * ```
 */
export async function docsFromPlainText(
	this: IExecuteFunctions,
	longText: string,
): Promise<{ pageContent: string; metadata: { chunk: number; tokenCount: number } }[]> {
	const { SummarizeCfg, encodingModel } = getNodeProperties(this);
	const logger = getLogger('docsFromPlainText');

	logger.info(`Processing text with ${countTokens(longText, encodingModel)} tokens`);

	const splitter = new RecursiveCharacterTextSplitter({
		chunkSize: SummarizeCfg.CHUNK_TOKENS,
		chunkOverlap: SummarizeCfg.CHUNK_OVERLAP,
		lengthFunction: (s: string) => countTokens(s, encodingModel),
	});

	const chunks = await splitter.splitText(longText);

	const docs = chunks.map((chunk, index) => {
		const tokenCount = countTokens(chunk, encodingModel);
		logger.debug(`Chunk ${index + 1}/${chunks.length}: ${tokenCount} tokens`);

		return {
			pageContent: chunk,
			metadata: {
				chunk: index,
				tokenCount: tokenCount,
			},
		};
	});

	const totalTokens = docs.reduce((sum, doc) => sum + doc.metadata.tokenCount, 0);
	logger.info(`Created ${docs.length} chunks with total ${totalTokens} tokens`);
	logger.debug(`Token distribution: [${docs.map((d) => d.metadata.tokenCount).join(', ')}]`);

	return docs;
}
