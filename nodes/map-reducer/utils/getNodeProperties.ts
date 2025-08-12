import { NodeOperationError, type IExecuteFunctions } from 'n8n-workflow';
import { getLogger } from './logger';

export interface SummarizeCfg {
	TOKENS_PER_MINUTE: number;
	TOKEN_BUDGET_TIMEOUT: number;
	REQUESTS_PER_MINUTE: number;
	QUEUE_INTERVAL: number;
	QUEUE_CONCURRENCY: number;
	TOKEN_BUDGET_WINDOWS: number;
	MAP_OUT_MAX: number;
	REDUCE_OUT_MAX: number;
	CHUNK_TOKENS: number;
	CHUNK_OVERLAP: number;
	HIERARCHY_GROUP_SIZE: number;
	TEMPERATURE: number;
}

export function getNodeProperties(context: IExecuteFunctions): {
	encodingModel: string;
	mapPromptProperties: string;
	combinePromptProperties: string;
	SummarizeCfg: SummarizeCfg;
} {
	const logger = getLogger('getNodeProperties');

	const encodingModel = context.getNodeParameter('encodingModel', 0) as string;
	if (!encodingModel) {
		logger.error('Encoding model is required but not provided');
		throw new NodeOperationError(context.getNode(), 'Encoding model is required but not provided');
	}

	const mapPromptProperties = context.getNodeParameter('mapPrompt', 0, '') as string;
	if (!mapPromptProperties || mapPromptProperties.trim() === '') {
		logger.error('Map prompt is required but not provided');
		throw new NodeOperationError(context.getNode(), 'Map prompt is required but not provided');
	}

	const combinePromptProperties = context.getNodeParameter('combinePrompt', 0, '') as string;
	if (!combinePromptProperties || combinePromptProperties.trim() === '') {
		logger.error('Combine prompt is required but not provided');
		throw new NodeOperationError(context.getNode(), 'Combine prompt is required but not provided');
	}

	// Retrieve and validate configuration parameters
	const tokensPerMinute = context.getNodeParameter('TOKENS_PER_MINUTE', 0) as number;
	if (!tokensPerMinute || tokensPerMinute <= 0) {
		logger.error('TOKENS_PER_MINUTE is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'TOKENS_PER_MINUTE is required and must be greater than 0',
		);
	}

	const tokenBudgetTimeout = context.getNodeParameter('TOKEN_BUDGET_TIMEOUT', 0) as number;
	if (!tokenBudgetTimeout || tokenBudgetTimeout <= 0) {
		logger.error('TOKEN_BUDGET_TIMEOUT is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'TOKEN_BUDGET_TIMEOUT is required and must be greater than 0',
		);
	}

	const requestsPerMinute = context.getNodeParameter('REQUESTS_PER_MINUTE', 0) as number;
	if (!requestsPerMinute || requestsPerMinute <= 0) {
		logger.error('REQUESTS_PER_MINUTE is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'REQUESTS_PER_MINUTE is required and must be greater than 0',
		);
	}

	const queueInterval = context.getNodeParameter('QUEUE_INTERVAL', 0) as number;
	if (!queueInterval || queueInterval <= 0) {
		logger.error('QUEUE_INTERVAL is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'QUEUE_INTERVAL is required and must be greater than 0',
		);
	}

	const queueConcurrency = context.getNodeParameter('QUEUE_CONCURRENCY', 0) as number;
	if (!queueConcurrency || queueConcurrency <= 0) {
		logger.error('QUEUE_CONCURRENCY is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'QUEUE_CONCURRENCY is required and must be greater than 0',
		);
	}

	const tokenBudgetWindows = context.getNodeParameter('TOKEN_BUDGET_WINDOWS', 0) as number;
	if (!tokenBudgetWindows || tokenBudgetWindows <= 0) {
		logger.error('TOKEN_BUDGET_WINDOWS is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'TOKEN_BUDGET_WINDOWS is required and must be greater than 0',
		);
	}

	const mapOutMax = context.getNodeParameter('MAP_OUT_MAX', 0) as number;
	if (!mapOutMax || mapOutMax <= 0) {
		logger.error('MAP_OUT_MAX is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'MAP_OUT_MAX is required and must be greater than 0',
		);
	}

	const reduceOutMax = context.getNodeParameter('REDUCE_OUT_MAX', 0) as number;
	if (!reduceOutMax || reduceOutMax <= 0) {
		logger.error('REDUCE_OUT_MAX is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'REDUCE_OUT_MAX is required and must be greater than 0',
		);
	}

	const chunkTokens = context.getNodeParameter('CHUNK_TOKENS', 0) as number;
	if (!chunkTokens || chunkTokens <= 0) {
		logger.error('CHUNK_TOKENS is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'CHUNK_TOKENS is required and must be greater than 0',
		);
	}

	const chunkOverlap = context.getNodeParameter('CHUNK_OVERLAP', 0) as number;
	if (chunkOverlap < 0) {
		logger.error('CHUNK_OVERLAP must be greater than or equal to 0');
		throw new NodeOperationError(
			context.getNode(),
			'CHUNK_OVERLAP must be greater than or equal to 0',
		);
	}

	const hierarchyGroupSize = context.getNodeParameter('HIERARCHY_GROUP_SIZE', 0) as number;
	if (!hierarchyGroupSize || hierarchyGroupSize <= 0) {
		logger.error('HIERARCHY_GROUP_SIZE is required and must be greater than 0');
		throw new NodeOperationError(
			context.getNode(),
			'HIERARCHY_GROUP_SIZE is required and must be greater than 0',
		);
	}

	const temperature = context.getNodeParameter('TEMPERATURE', 0) as number;
	if (temperature < 0 || temperature > 2) {
		logger.error('TEMPERATURE must be between 0 and 2');
		throw new NodeOperationError(context.getNode(), 'TEMPERATURE must be between 0 and 2');
	}

	const SummarizeCfg: SummarizeCfg = {
		TOKENS_PER_MINUTE: tokensPerMinute,
		TOKEN_BUDGET_TIMEOUT: tokenBudgetTimeout * 1000, // Convert to milliseconds
		REQUESTS_PER_MINUTE: requestsPerMinute,
		QUEUE_INTERVAL: queueInterval * 1000, // Convert to milliseconds
		QUEUE_CONCURRENCY: queueConcurrency,
		TOKEN_BUDGET_WINDOWS: tokenBudgetWindows * 1000, // Convert to milliseconds
		MAP_OUT_MAX: mapOutMax,
		REDUCE_OUT_MAX: reduceOutMax,
		CHUNK_TOKENS: chunkTokens,
		CHUNK_OVERLAP: chunkOverlap,
		HIERARCHY_GROUP_SIZE: hierarchyGroupSize,
		TEMPERATURE: temperature,
	};

	return {
		encodingModel,
		mapPromptProperties,
		combinePromptProperties,
		SummarizeCfg,
	};
}
