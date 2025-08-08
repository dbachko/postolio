/**
 * OpenAI API Mock for Testing
 * Provides consistent mock responses for all OpenAI API calls
 */
export declare const mockOpenAIResponse: {
    choices: {
        message: {
            content: string;
        };
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
};
export declare const mockBrandAnalysisResponse: {
    choices: {
        message: {
            content: string;
        };
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
};
export declare const mockOptimizationResponse: {
    choices: {
        message: {
            content: string;
        };
    }[];
};
export declare class MockOpenAI {
    chat: {
        completions: {
            create: (params: any) => Promise<{
                choices: {
                    message: {
                        content: string;
                    };
                }[];
            }>;
        };
    };
    images: {
        generate: (params: any) => Promise<{
            data: {
                url: string;
                revised_prompt: any;
            }[];
        }>;
    };
}
export declare const mockOpenAI: MockOpenAI;
