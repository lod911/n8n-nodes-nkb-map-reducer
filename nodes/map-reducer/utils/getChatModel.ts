import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import { type IExecuteFunctions, NodeConnectionType } from 'n8n-workflow';

export async function getChatModel(
	ctx: IExecuteFunctions,
	index: number = 0,
): Promise<BaseLanguageModel | undefined> {
	const connectedModels = await ctx.getInputConnectionData(NodeConnectionType.AiLanguageModel, 0);

	let model;

	if (Array.isArray(connectedModels) && index !== undefined) {
		if (connectedModels.length <= index) {
			return undefined;
		}
		// We get the models in reversed order from the workflow so we need to reverse them again to match the right index
		const reversedModels = [...connectedModels].reverse();
		model = reversedModels[index] as BaseLanguageModel;
	} else {
		model = connectedModels as BaseLanguageModel;
	}

	return model;
}
