# Creamus AI Map Reducer

An advanced n8n node package for performing hierarchical map-reduce summarization of large datasets using AI language models with sophisticated token budget management and rate limiting capabilities.

## Overview

The Creamus AI Map Reducer implements a sophisticated map-reduce pattern specifically designed for summarizing large volumes of text data (such as financial news articles) using AI language models. It features:

- **Hierarchical Map-Reduce Processing**: Efficiently processes large datasets by splitting them into manageable chunks, processing each chunk individually (map phase), then hierarchically combining results (reduce phase)
- **Token Budget Management**: Advanced token tracking and budget enforcement to stay within API rate limits
- **Queue-based Processing**: Intelligent request queuing with configurable concurrency and rate limiting
- **Automatic Retry Logic**: Robust error handling with exponential backoff for transient failures
- **Flexible Text Splitting**: Token-aware text chunking with configurable overlap
- **Multi-encoding Support**: Support for both o200k and cl100k token encoding models

## Features

### Core Functionality

- **Map-Reduce Architecture**: Scalable processing of large text datasets
- **Token-Aware Processing**: Precise token counting and budget management
- **Hierarchical Reduction**: Tree-based combination of partial results
- **Rate Limit Compliance**: Automatic handling of API rate limits (TPM/RPM)
- **Error Recovery**: Robust retry mechanisms with intelligent backoff strategies

### Configuration Options

- **Customizable Prompts**: Separate prompts for map and combine operations
- **Token Limits**: Configurable TPM (Tokens Per Minute) and RPM (Requests Per Minute) limits
- **Processing Parameters**: Adjustable chunk sizes, overlap, and hierarchy group sizes
- **Temperature Control**: Fine-tune AI model creativity/consistency
- **Encoding Models**: Choose between o200k (default) and cl100k encoding

## Installation

### Prerequisites

- Node.js 20.15 or higher
- n8n installation
- AI Language Model node (OpenAI, Azure OpenAI, etc.)

### Install Dependencies

```bash
npm install
```

### Build the Node

```bash
npm run build
```

## Usage

### Basic Setup

1. Add the Creamus AI Map Reducer node to your n8n workflow
2. Connect an AI Language Model node (required input)
3. Connect your data source to the main input
4. Configure the processing parameters

### Input Requirements

- **Main Input**: Array of data objects to be processed
- **AI Language Model**: Connected AI model for text processing

### Configuration Parameters

#### Prompts

- **Map Prompt**: Template for processing individual chunks
- **Combine Prompt**: Template for combining processed results

#### Rate Limiting

- **Tokens per Minute (TPM)**: Maximum tokens processable per minute
- **Requests per Minute (RPM)**: Maximum API requests per minute
- **Map Output Maximum**: Token limit for individual map operations
- **Reduce Output Maximum**: Token limit for combine operations

#### Processing Control

- **Queue Concurrency**: Number of simultaneous operations
- **Chunk Tokens**: Size of text chunks for processing
- **Chunk Overlap**: Token overlap between chunks
- **Hierarchy Group Size**: Grouping size for hierarchical reduction

#### Model Settings

- **Temperature**: AI model creativity control (0.0-2.0)
- **Encoding Model**: Token encoding method (o200k/cl100k)

### Example Use Case: Financial News Summarization

```javascript
// Input data structure
[
  {
    "contentString": "Article content...",
    "title": "Article title",
    "url": "https://example.com/article"
  }
]

// Output structure
{
  "mail": "HTML-formatted summary with categories and source links"
}
```

## Architecture

### Map-Reduce Workflow

1. **Input Processing**: Data is converted to token-aware document chunks
2. **Map Phase**: Each chunk is processed individually using the map prompt
3. **Hierarchical Reduce**: Results are combined in tree-like structure using the combine prompt
4. **Output Generation**: Final HTML-formatted summary is produced

### Token Budget Management

- **Real-time Tracking**: Monitors token usage across sliding time windows
- **Predictive Budgeting**: Estimates token requirements before API calls
- **Automatic Waiting**: Pauses processing when approaching rate limits
- **Timeout Protection**: Prevents infinite waiting with configurable timeouts

### Error Handling

- **Retry Logic**: Automatic retries for transient failures
- **Rate Limit Handling**: Intelligent backoff for 429 responses
- **Server Error Recovery**: Exponential backoff for 5xx errors
- **Graceful Degradation**: Continues processing when individual chunks fail

## Development

### Project Structure

```
├── nodes/
│   └── map-reducer/
│       ├── MapReducer.node.ts              # Main node implementation
│       ├── MapReducer.node.properties.ts   # Node configuration
│       ├── MapReducer.node.summarize.ts    # Core map-reduce logic
│       └── utils/
│           ├── getChatModel.ts             # AI model interface
│           ├── getNodeProperties.ts        # Configuration management
│           ├── helper-functions.ts         # Core utilities
│           └── logger.ts                   # Logging utilities
├── package.json                            # Package configuration
├── tsconfig.json                          # TypeScript configuration
└── gulpfile.js                           # Build configuration
```

### Key Dependencies

- **@langchain/openai**: AI model integration
- **@langchain/textsplitters**: Intelligent text chunking
- **gpt-tokenizer**: Precise token counting
- **p-queue**: Advanced request queuing
- **p-retry**: Robust retry mechanisms
- **pino**: Structured logging

### Building

```bash
# Development build with watch
npm run dev

# Production build
npm run build

# Linting
npm run lint
npm run lintfix

# Formatting
npm run format
```

### Testing

```bash
# Build and package for testing
npm run deployTest
```

## Configuration Examples

### High-Volume Processing

```javascript
{
  "TOKENS_PER_MINUTE": 100000,
  "REQUESTS_PER_MINUTE": 100,
  "QUEUE_CONCURRENCY": 10,
  "CHUNK_TOKENS": 20000,
  "HIERARCHY_GROUP_SIZE": 3
}
```

### Conservative Rate Limiting

```javascript
{
  "TOKENS_PER_MINUTE": 20000,
  "REQUESTS_PER_MINUTE": 20,
  "QUEUE_CONCURRENCY": 2,
  "CHUNK_TOKENS": 10000,
  "HIERARCHY_GROUP_SIZE": 2
}
```

## Performance Considerations

### Token Usage Optimization

- **Chunk Size**: Larger chunks reduce overhead but increase memory usage
- **Overlap**: Minimal overlap reduces redundancy while maintaining context
- **Group Size**: Smaller hierarchy groups reduce token usage per operation

### Rate Limit Management

- Set TPM and RPM based on your API subscription limits
- Monitor logs for rate limit warnings
- Adjust concurrency based on your API's capabilities

### Memory Management

- Large datasets are processed in chunks to prevent memory issues
- Streaming processing reduces peak memory requirements
- Configurable timeouts prevent resource leaks

## Troubleshooting

### Common Issues

#### Token Budget Timeouts

- **Cause**: Insufficient TPM allocation or high token usage
- **Solution**: Increase TPM limits or reduce chunk sizes

#### Rate Limit Errors

- **Cause**: Exceeding API rate limits
- **Solution**: Reduce RPM/concurrency or increase intervals

#### Memory Issues

- **Cause**: Large input datasets or chunk sizes
- **Solution**: Reduce chunk tokens or hierarchy group size

### Logging

The node provides comprehensive logging with configurable levels:

- **Error**: Critical failures and exceptions
- **Warn**: Rate limit approaches and recoverable issues
- **Info**: Processing progress and completion status
- **Debug**: Detailed token usage and queue statistics
- **Trace**: Verbose operation details

Set `NODE_LOG_LEVEL` environment variable to control verbosity.

## License

Copyright (C) creamus gmbh - All Rights Reserved.
Proprietary and confidential.

## Author

Linus Odolon  
Email: linus.odolon@creamus.ch  
Company: creamus gmbh  
Website: https://creamus.ch

## Repository

GitHub: https://github.com/lod911/n8n-nodes-creamus-map-reducer
