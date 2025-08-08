/**
 * Midjourney API Mock for Testing
 * Provides consistent mock responses for all Midjourney API calls
 */
export const mockMidjourneyResponse = {
    success: true,
    messageId: 'mock-message-id-123',
    uri: 'https://example.com/mock-midjourney-image.jpg',
    status: 'completed',
    progress: '100%',
    content: 'Modern minimalist workspace with clean lines and natural lighting, featuring a laptop and coffee cup on a wooden desk --ar 1:1 --v 6'
};
export const mockMidjourneyProgress = {
    success: true,
    messageId: 'mock-message-id-123',
    status: 'in-progress',
    progress: '45%',
    uri: null
};
export const mockMidjourneyError = {
    success: false,
    error: 'Mock error for testing',
    messageId: null,
    status: 'failed'
};
// Mock the Midjourney class/service
export class MockMidjourney {
    async imagine(prompt, options) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 50));
        // Simulate different responses based on prompt content
        if (prompt.includes('error') || prompt.includes('fail')) {
            return mockMidjourneyError;
        }
        return {
            ...mockMidjourneyResponse,
            content: prompt + ' --ar 1:1 --v 6'
        };
    }
    async upscale(messageId, index) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 30));
        return {
            success: true,
            messageId: `${messageId}-upscale-${index}`,
            uri: `https://example.com/mock-upscaled-image-${index}.jpg`,
            status: 'completed',
            progress: '100%'
        };
    }
    async getResult(messageId) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 10));
        if (messageId.includes('progress')) {
            return mockMidjourneyProgress;
        }
        return {
            ...mockMidjourneyResponse,
            messageId
        };
    }
    async info() {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 5));
        return {
            success: true,
            subscription: 'Basic Plan',
            job_mode: 'fast',
            visibility: 'public',
            fast_time_remaining: '15h 32m',
            lifetime_usage: '1,247 GPU minutes',
            relaxed_usage: '98 GPU minutes'
        };
    }
}
export const mockMidjourney = new MockMidjourney();
