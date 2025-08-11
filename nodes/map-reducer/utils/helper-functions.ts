import { encode as encode_o200k_base } from 'gpt-tokenizer/cjs/encoding/o200k_base';
import { encode as encode_cl100k_base } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getLogger } from './logger';
import { SummarizeCfg } from './getNodeProperties';

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
 * Erstellt eine konfigurierte PQueue-Instanz mit Token-Budget-Tracker.
 *
 * Initialisiert eine Warteschlange (PQueue) mit Rate-Limiting-Konfiguration
 * basierend auf den konfigurierten Requests pro Minute (RPM). Zusätzlich wird
 * ein TokenBudgetTracker für die Token-Überwachung erstellt.
 *
 * @param config - Konfigurationsobjekt mit den benötigten Parametern
 * @returns queue - PQueue-Instanz mit Concurrency- und Rate-Limiting-Konfiguration
 * @returns tokenTracker - TokenBudgetTracker-Instanz für Token-Management
 *
 * @example
 * ```typescript
 * const { queue, tokenTracker } = makeQueue(config);
 *
 * // Aufgabe zur Queue hinzufügen
 * await queue.add(async () => {
 *   // API-Aufruf
 * });
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
	if (texts.length <= groupSize) {
		return reduceJob(texts.join('\n\n---\n\n'));
	}
	const groups: string[][] = [];
	for (let i = 0; i < texts.length; i += groupSize) {
		groups.push(texts.slice(i, i + groupSize));
	}
	const level = await Promise.all(groups.map((g) => reduceJob(g.join('\n\n---\n\n'))));
	return hierarchicalReduce(level, reduceJob, groupSize);
}

/**
 * Erstellt einen Token-bewussten Text-Splitter.
 *
 * Konfiguriert einen RecursiveCharacterTextSplitter, der Texte basierend
 * auf Token-Anzahl anstatt Zeichen aufteilt. Dies ist wichtig für die
 * Einhaltung von Token-Limits bei API-Aufrufen.
 *
 * @param config - Konfigurationsobjekt mit CHUNK_TOKENS und CHUNK_OVERLAP
 * @param encodingModel - Das zu verwendende Encoding-Modell
 * @returns Konfigurierter RecursiveCharacterTextSplitter mit Token-basierter Längenberechnung
 *
 * @example
 * ```typescript
 * const splitter = makeTokenAwareSplitter(config, 'o200k');
 * const chunks = await splitter.splitText("Sehr langer Text...");
 * ```
 */
export function makeTokenAwareSplitter(config: SummarizeCfg, encodingModel: string) {
	return new RecursiveCharacterTextSplitter({
		chunkSize: config.CHUNK_TOKENS,
		chunkOverlap: config.CHUNK_OVERLAP,
		lengthFunction: (s: string) => countTokens(s, encodingModel),
	});
}

/**
 * Konvertiert einen langen Text in ein Array von Dokumenten.
 *
 * Teilt einen langen Text mit Hilfe des Token-bewussten Splitters in
 * kleinere Chunks auf und erstellt daraus ein Array von Dokumenten-Objekten.
 * Jedes Dokument enthält den Text-Inhalt und Metadaten mit Chunk-Nummer.
 *
 * @param longText - Der zu teilende lange Text
 * @param config - Konfigurationsobjekt für den Splitter
 * @param encodingModel - Das zu verwendende Encoding-Modell
 * @returns Promise mit einem Array von Dokumenten-Objekten
 *
 * @example
 * ```typescript
 * const docs = await docsFromPlainText("Sehr langer Text mit vielen Nachrichten...", config, 'o200k');
 * console.log(`Aufgeteilt in ${docs.length} Chunks`);
 * ```
 */
export async function docsFromPlainText(
	longText: string,
	config: SummarizeCfg,
	encodingModel: string,
) {
	const splitter = makeTokenAwareSplitter(config, encodingModel);
	const chunks = await splitter.splitText(longText);
	return chunks.map((c, i) => ({ pageContent: c, metadata: { chunk: i } }));
}
