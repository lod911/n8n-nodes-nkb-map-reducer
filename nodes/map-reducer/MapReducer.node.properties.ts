import { INodeTypeDescription, NodeConnectionType } from 'n8n-workflow';

export const mapReducerNodeDescription: INodeTypeDescription = {
	displayName: 'Creamus AI Map Reducer',
	name: 'mapReducer',
	group: ['transform', 'AI'],
	version: 1,
	icon: 'file:creamusLogo.svg',
	description:
		'Performs hierarchical map-reduce summarization of financial news articles using AI language models with token budget management and rate limiting.',
	defaults: {
		name: 'Creamus AI Map Reducer',
	},
	inputs: [
		{ type: NodeConnectionType.Main, required: true, displayName: 'Input Data' },
		{ type: NodeConnectionType.AiLanguageModel, required: true, displayName: 'AI Language Model' },
	],
	outputs: [NodeConnectionType.Main],
	properties: [
		{
			displayName:
				'The Rate Limits "Tokens Per Minute" (TPM / TOKENS_PER_MINUTE) and "Requests Per Minute" (RPM / REQUESTS_PER_MINUTE) can looked up in the Azure portal.',
			name: 'infoAzure',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Map Prompt',
			name: 'mapPrompt',
			type: 'string',
			noDataExpression: false,
			description: 'The prompt used for the map operation to summarize each article.',
			default: `
# Deine Rolle
Du bist ein erfahrener und professioneller Finanzexperte der Finanz-News Artikel zusammenfasst.

# Eingabeformat
Das Array[1] ist ein JSON-Array
Die einzelnen Einträge im Array[1] stammen von unterschiedlichen Finanz-Portalen.
Im Array gibt es drei Werte: contentString, title und URL.
Wobei der title der Titel der Nachricht ist, der contentString die eigentliche Nachricht enthält und die URL den Link zu der Quelle.
Die Nachrichten sind in deutscher Sprache verfasst.
Jeder Eintrag ist eine einzelne Nachricht.

# Aufgabe
Erstelle eine Zusammenfassung nur von den contentString Variablen im übergebenen Array[1].
Du sollst keine Informationen erfinden.
Deine Angaben sollen reine Fakten sein.
Die Zusammenfassung sollte die wichtigsten Informationen aus den einzelnen Nachrichten die sich jeweils beim contentString befinden, extrahieren und in einem klaren, prägnanten Format präsentiert werden.

# Umfang
Die Zusammenfassung soll rund 100 Wörter oder weniger lang sein.

# Ausgabeformat
Es soll ein JSON -Objekt zurückgegeben werden, das die folgenden Felder enthält:
- urls: Eine Liste von URLs, die als Nachweis für die Zusammenfassung dienen.
- contentString: Die Zusammenfassung der Nachrichten im Array[1].

Schreibe keine sonstigen Erklärungen oder Bemerkungen.
Die Antwort soll so sein, dass die Antwort für eine weitere Zusammenfassung verwendet werden kann.

# Array[1]: "{text}"
`,
		},
		{
			displayName: 'Combine Prompt',
			name: 'combinePrompt',
			type: 'string',
			noDataExpression: false,
			description:
				'The prompt used for the last combine operation to summarize the results of the map operation.',
			default: `
# Deine Rolle
Du bist ein erfahrener und professioneller Finanzexperte der Finanz-News Artikel zusammenfasst.

# Eingabeformat
Das Array[2] ist ein JSON-Array
Die einzelnen Einträge im Array[2] beinhaltet diverse Zusammenfassungen aus vorherigen Verarbeitungen.
Die einzelnen Zusammenfassungen stammen aus unterschiedlichen Finanz-Portalen.
Im Array gibt es zwei Werte: contentString und urls.
Wobei der contentString die eigentliche Nachricht enthält und die urls einen oder mehrere Links zu den Quellen enthalten.
Die Nachrichten sind in deutscher Sprache verfasst.

# Aufgabe
Erstelle in deutscher Sprache eine Zusammenfassung vom übergebenen Array[2].
Du sollst keine Informationen erfinden.
Deine Angaben sollen reine Fakten sein.
Die Zusammenfassung sollte die wichtigsten Informationen aus den einzelnen Nachrichten extrahieren und in einem klaren, prägnanten Format präsentiert werden.
Die Zusammenfassung soll in Kategorien[3] unterteilt werden.

# Umfang
Die Lesedauer pro Kategorie[3] soll rund 5 Minuten oder weniger betragen.

# Ausgabeformat
Das Ergebnis soll als HTML-Code in einer E-Mail verwendet werden können.
Antworte nur mit dem HTML-Code, ohne Markdown-Codeblöcke oder sonstige Erklärungen/Bemerkungen.
Pro Kategorie[3] soll jeweils ein Titel und der Inhalt im HTML-Format ausgegeben werden.
Der Titel soll ein passendes ACSII-Icon am Anfang haben.
Zu jeder Zusammenfassung sollen die URLs aus Array[2] als Nachweis hinzugefügt werden.
Zu jeder Zusammenfassung soll die Relevanz zu den Märkten (unterhalb des Nachweises) oder Regionen (APAC, DACH, SMI, DAX, EURO, USA) hinzugefügt werden.

# Kategorien[3]
- Marktüberblick
- Anlageempfehlungen
- Wirtschaftsnachrichten

# Array[2]: "{text}"
`,
		},
		{
			displayName: 'Tokens per Minute (TPM)',
			name: 'TOKENS_PER_MINUTE',
			type: 'number',
			noDataExpression: true,
			default: 50000,
			description:
				'The number of tokens that can be processed per minute. This is used to calculate the time it takes to process the input tokens. (TOKENS_PER_MINUTE)',
		},
		{
			displayName: 'Requests per Minute (RPM)',
			name: 'REQUESTS_PER_MINUTE',
			type: 'number',
			noDataExpression: true,
			default: 50,
			description: 'The maximum number of requests that can be made per minute to the API service.',
		},
		{
			displayName: 'Map Output Maximum',
			name: 'MAP_OUT_MAX',
			type: 'number',
			noDataExpression: true,
			default: 25000,
			description:
				'The maximum number of tokens for map/partial operation output. Close to the TPM but with a deduction for the respective prompt.',
		},
		{
			displayName: 'Reduce Output Maximum',
			name: 'REDUCE_OUT_MAX',
			type: 'number',
			noDataExpression: true,
			default: 35000,
			description:
				'The maximum number of tokens for reduce/final operation output. Must be significantly lower than TPM to allow for prompt tokens.',
		},
		{
			displayName: 'Tokens Budget Timeout in seconds',
			name: 'TOKEN_BUDGET_TIMEOUT',
			type: 'number',
			noDataExpression: true,
			default: 180,
			description:
				'Maximum time in seconds to wait for sufficient token budget before throwing a timeout error. Increased for large operations.',
		},
		{
			displayName: 'Queue Interval in seconds',
			name: 'QUEUE_INTERVAL',
			type: 'number',
			noDataExpression: true,
			default: 60,
			description: 'The interval in seconds between queue processing cycles.',
		},
		{
			displayName: 'Queue Concurrency',
			name: 'QUEUE_CONCURRENCY',
			type: 'number',
			noDataExpression: true,
			default: 5,
			description: 'The maximum number of concurrent operations in the queue.',
		},
		{
			displayName: 'Token Budget Window in seconds',
			name: 'TOKEN_BUDGET_WINDOWS',
			type: 'number',
			noDataExpression: true,
			default: 60,
			description: 'The time window in seconds for token budget calculations.',
		},
		{
			displayName: 'Chunk Tokens',
			name: 'CHUNK_TOKENS',
			type: 'number',
			noDataExpression: true,
			default: 18000,
			description:
				'The number of tokens per chunk when splitting input data. Smaller chunks reduce memory pressure in reduce phase.',
		},
		{
			displayName: 'Chunk Overlap',
			name: 'CHUNK_OVERLAP',
			type: 'number',
			noDataExpression: true,
			default: 500,
			description: 'The number of overlapping tokens between consecutive chunks.',
		},
		{
			displayName: 'Hierarchy Group Size',
			name: 'HIERARCHY_GROUP_SIZE',
			type: 'number',
			noDataExpression: true,
			default: 2,
			description:
				'The size of groups when organizing data in hierarchical structure. Smaller groups reduce token usage per reduce operation.',
		},
		{
			displayName: 'Temperature',
			name: 'TEMPERATURE',
			type: 'number',
			noDataExpression: true,
			default: 0.2,
			description:
				'Controls randomness in AI text generation. Values range from 0 (deterministic, focused) to 2 (highly creative, random). Lower values produce more consistent and predictable outputs, while higher values increase creativity and variability. For summarization tasks, values between 0.0-0.5 are typically recommended.',
		},
		{
			displayName: 'Encoding Model',
			name: 'encodingModel',
			type: 'options',
			noDataExpression: true,
			description:
				'The encoding model to use for encoding and decoding tokens. - o200k is the default and recommended for most use cases. - cl100k is used for compatibility with older OpenAI models.',
			options: [
				{
					name: 'o200k',
					value: 'o200k',
					description: 'Use the o200k encoding model',
					action: 'Use the o200k encoding model',
				},
				{
					name: 'cl100k',
					value: 'cl100k',
					description: 'Use the cl100k encoding model',
					action: 'Use the cl100k encoding model',
				},
			],
			default: 'o200k',
		},
	],
};
