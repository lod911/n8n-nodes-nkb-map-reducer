import {
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
} from 'n8n-workflow';
import { mapReducerNodeDescription } from './MapReducer.node.properties';
import { getLogger } from './utils/logger';
import { PromptTemplate } from '@langchain/core/prompts';
import { getChatModel } from './utils/getChatModel';
import { getNodeProperties } from './utils/getNodeProperties';
import { docsFromPlainText, makeQueue } from './utils/helper-functions';
import { summarizeWithQueue } from './MapReducer.node.summarize';

export class MapReducer implements INodeType {
	description = mapReducerNodeDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const logger = getLogger('MapReduceTest');
		const items = this.getInputData();
		if (items.length === 0) {
			logger.warn('No input data provided, returning empty result');
			return [[]];
		}

		const model = await getChatModel(this);
		if (!model) {
			logger.error('No AI Language Model connected. Please connect an AI Language Model node.');
			throw new NodeOperationError(
				this.getNode(),
				'No AI Language Model connected. Please connect an AI Language Model node.',
			);
		}

		// Parameter und Konfiguration abrufen
		const { encodingModel, mapPromptProperties, combinePromptProperties, SummarizeCfg } =
			getNodeProperties(this);

		const mapPrompt = PromptTemplate.fromTemplate(mapPromptProperties);
		const combinePrompt = PromptTemplate.fromTemplate(combinePromptProperties);

		const docs = await docsFromPlainText(
			JSON.stringify(items.map((i) => i.json)),
			SummarizeCfg,
			encodingModel,
		);
		const { queue, tokenTracker } = makeQueue(SummarizeCfg);

		const mail = await summarizeWithQueue(
			docs,
			model,
			queue,
			tokenTracker,
			mapPrompt,
			combinePrompt,
			SummarizeCfg,
			encodingModel,
		);

		return [[{ json: { mail } }]];
	}
}
