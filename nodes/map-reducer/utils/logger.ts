import pino from 'pino';
export * from 'pino';

export const pinoConfig: pino.LoggerOptions = {
	name: 'n8n-nodes-mapreducer',
	level: process.env.NODE_LOG_LEVEL || 'info',
	redact: {
		censor: '*** removed ***',
		paths: ['password'],
	},
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => {
			return { level: label.toUpperCase() };
		},
	},
};

export function getLogger(MsgPrefix: string, addPinoConf = {}) {
	const logger = pino({
		...pinoConfig,
		msgPrefix: '[' + MsgPrefix + '] ',
		...addPinoConf,
	});
	return logger;
}

export function ensureError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}

	let stringified = '❗❗❗ [Unable to stringify the thrown value]';

	try {
		stringified = JSON.stringify(value);
	} catch (error) {
		throw Error('ensureError Failure!!!', { cause: error });
	}

	const error = new Error(`⛔ Stringified Error: ${stringified}`);
	return error;
}
