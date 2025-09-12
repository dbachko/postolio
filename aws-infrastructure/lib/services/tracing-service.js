"use strict";
/**
 * X-Ray Distributed Tracing Service
 * Provides distributed tracing across all microservices
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.tracingService = exports.TracingService = void 0;
const AWSXRay = __importStar(require("aws-xray-sdk-core"));
// Only capture AWS SDK calls in production
if (process.env.NODE_ENV === 'production') {
    AWSXRay.captureAWS(require('aws-sdk'));
}
class TracingService {
    static instance;
    static getInstance() {
        if (!TracingService.instance) {
            TracingService.instance = new TracingService();
        }
        return TracingService.instance;
    }
    /**
     * Trace an operation with X-Ray
     */
    async traceOperation(operationName, operation, metadata) {
        // In development, just execute without tracing
        if (process.env.NODE_ENV !== 'production') {
            return operation();
        }
        const segment = AWSXRay.getSegment();
        if (!segment) {
            // No active segment, execute without tracing
            console.warn(`No active X-Ray segment for operation: ${operationName}`);
            return operation();
        }
        const subsegment = segment.addNewSubsegment(operationName);
        try {
            // Add metadata
            if (metadata) {
                Object.entries(metadata).forEach(([key, value]) => {
                    if (value !== undefined) {
                        // Add as annotation for searchability
                        if (['correlationId', 'userId', 'brandId'].includes(key)) {
                            subsegment.addAnnotation(key, String(value));
                        }
                        // Add as metadata for detail
                        subsegment.addMetadata(key, value);
                    }
                });
            }
            // Execute operation
            const result = await operation();
            // Mark as successful
            subsegment.close();
            return result;
        }
        catch (error) {
            // Add error to subsegment
            subsegment.addError(error);
            subsegment.close(error);
            throw error;
        }
    }
    /**
     * Trace an HTTP request
     */
    async traceHttpRequest(url, method, operation, metadata) {
        return this.traceOperation(`HTTP ${method} ${url}`, async () => {
            const startTime = Date.now();
            try {
                const result = await operation();
                const duration = Date.now() - startTime;
                // Log successful request
                console.log(`HTTP ${method} ${url} - ${duration}ms`, {
                    correlationId: metadata?.correlationId,
                });
                return result;
            }
            catch (error) {
                const duration = Date.now() - startTime;
                // Log failed request
                console.error(`HTTP ${method} ${url} - ${duration}ms - FAILED`, {
                    correlationId: metadata?.correlationId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                throw error;
            }
        }, {
            ...metadata,
            httpMethod: method,
            url,
        });
    }
    /**
     * Trace a database operation
     */
    async traceDatabaseOperation(tableName, operation, query, metadata) {
        return this.traceOperation(`DynamoDB.${operation}`, async () => {
            const startTime = Date.now();
            try {
                const result = await query();
                const duration = Date.now() - startTime;
                // Log successful query
                console.log(`DynamoDB ${operation} on ${tableName} - ${duration}ms`, {
                    correlationId: metadata?.correlationId,
                });
                return result;
            }
            catch (error) {
                const duration = Date.now() - startTime;
                // Log failed query
                console.error(`DynamoDB ${operation} on ${tableName} - ${duration}ms - FAILED`, {
                    correlationId: metadata?.correlationId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                throw error;
            }
        }, {
            ...metadata,
            tableName,
            operation,
        });
    }
    /**
     * Add custom annotation to current segment
     */
    addAnnotation(key, value) {
        if (process.env.NODE_ENV !== 'production')
            return;
        const segment = AWSXRay.getSegment();
        if (segment) {
            segment.addAnnotation(key, String(value));
        }
    }
    /**
     * Add custom metadata to current segment
     */
    addMetadata(namespace, key, value) {
        if (process.env.NODE_ENV !== 'production')
            return;
        const segment = AWSXRay.getSegment();
        if (segment) {
            segment.addMetadata(key, value, namespace);
        }
    }
    /**
     * Create a new subsegment for custom operations
     */
    createSubsegment(name) {
        if (process.env.NODE_ENV !== 'production')
            return null;
        const segment = AWSXRay.getSegment();
        if (segment) {
            return segment.addNewSubsegment(name);
        }
        return null;
    }
    /**
     * Get correlation ID from current segment
     */
    getCorrelationId() {
        if (process.env.NODE_ENV !== 'production') {
            return crypto.randomUUID();
        }
        const segment = AWSXRay.getSegment();
        if (segment) {
            const annotations = segment.annotations;
            return annotations?.correlationId;
        }
        return undefined;
    }
    /**
     * Wrap a Lambda handler with X-Ray tracing
     */
    static traceLambdaHandler(handlerName, handler) {
        if (process.env.NODE_ENV !== 'production') {
            return handler;
        }
        return async (event, context) => {
            const segment = AWSXRay.getSegment();
            if (!segment) {
                // No segment available, execute without tracing
                return handler(event, context);
            }
            // Add Lambda context to segment
            segment.addAnnotation('handler', handlerName);
            segment.addAnnotation('requestId', context.requestId);
            // Add event metadata
            if (event.correlationId) {
                segment.addAnnotation('correlationId', event.correlationId);
            }
            try {
                const result = await handler(event, context);
                return result;
            }
            catch (error) {
                segment.addError(error);
                throw error;
            }
        };
    }
}
exports.TracingService = TracingService;
// Export singleton instance
exports.tracingService = TracingService.getInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2luZy1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidHJhY2luZy1zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDJEQUE0QztBQUc1QywyQ0FBMkM7QUFDM0MsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxZQUFZLEVBQUUsQ0FBQztJQUMxQyxPQUFPLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFBO0FBQ3hDLENBQUM7QUFTRCxNQUFhLGNBQWM7SUFDakIsTUFBTSxDQUFDLFFBQVEsQ0FBZ0I7SUFFdkMsTUFBTSxDQUFDLFdBQVc7UUFDaEIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUM3QixjQUFjLENBQUMsUUFBUSxHQUFHLElBQUksY0FBYyxFQUFFLENBQUE7UUFDaEQsQ0FBQztRQUNELE9BQU8sY0FBYyxDQUFDLFFBQVEsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUNsQixhQUFxQixFQUNyQixTQUEyQixFQUMzQixRQUF3QjtRQUV4QiwrQ0FBK0M7UUFDL0MsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsS0FBSyxZQUFZLEVBQUUsQ0FBQztZQUMxQyxPQUFPLFNBQVMsRUFBRSxDQUFBO1FBQ3BCLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFcEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2IsNkNBQTZDO1lBQzdDLE9BQU8sQ0FBQyxJQUFJLENBQUMsMENBQTBDLGFBQWEsRUFBRSxDQUFDLENBQUE7WUFDdkUsT0FBTyxTQUFTLEVBQUUsQ0FBQTtRQUNwQixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixD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dXJjZXNDb250ZW50IjpbIi8qKlxuICogWC1SYXkgRGlzdHJpYnV0ZWQgVHJhY2luZyBTZXJ2aWNlXG4gKiBQcm92aWRlcyBkaXN0cmlidXRlZCB0cmFjaW5nIGFjcm9zcyBhbGwgbWljcm9zZXJ2aWNlc1xuICovXG5cbmltcG9ydCAqIGFzIEFXU1hSYXkgZnJvbSAnYXdzLXhyYXktc2RrLWNvcmUnXG5pbXBvcnQgeyBTdWJzZWdtZW50LCBTZWdtZW50IH0gZnJvbSAnYXdzLXhyYXktc2RrLWNvcmUnXG5cbi8vIE9ubHkgY2FwdHVyZSBBV1MgU0RLIGNhbGxzIGluIHByb2R1Y3Rpb25cbmlmIChwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ3Byb2R1Y3Rpb24nKSB7XG4gIEFXU1hSYXkuY2FwdHVyZUFXUyhyZXF1aXJlKCdhd3Mtc2RrJykpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VNZXRhZGF0YSB7XG4gIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmdcbiAgdXNlcklkPzogc3RyaW5nXG4gIGJyYW5kSWQ/OiBzdHJpbmdcbiAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBjbGFzcyBUcmFjaW5nU2VydmljZSB7XG4gIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBUcmFjaW5nU2VydmljZVxuICBcbiAgc3RhdGljIGdldEluc3RhbmNlKCk6IFRyYWNpbmdTZXJ2aWNlIHtcbiAgICBpZiAoIVRyYWNpbmdTZXJ2aWNlLmluc3RhbmNlKSB7XG4gICAgICBUcmFjaW5nU2VydmljZS5pbnN0YW5jZSA9IG5ldyBUcmFjaW5nU2VydmljZSgpXG4gICAgfVxuICAgIHJldHVybiBUcmFjaW5nU2VydmljZS5pbnN0YW5jZVxuICB9XG4gIFxuICAvKipcbiAgICogVHJhY2UgYW4gb3BlcmF0aW9uIHdpdGggWC1SYXlcbiAgICovXG4gIGFzeW5jIHRyYWNlT3BlcmF0aW9uPFQ+KFxuICAgIG9wZXJhdGlvbk5hbWU6IHN0cmluZyxcbiAgICBvcGVyYXRpb246ICgpID0+IFByb21pc2U8VD4sXG4gICAgbWV0YWRhdGE/OiBUcmFjZU1ldGFkYXRhXG4gICk6IFByb21pc2U8VD4ge1xuICAgIC8vIEluIGRldmVsb3BtZW50LCBqdXN0IGV4ZWN1dGUgd2l0aG91dCB0cmFjaW5nXG4gICAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICAgIHJldHVybiBvcGVyYXRpb24oKVxuICAgIH1cbiAgICBcbiAgICBjb25zdCBzZWdtZW50ID0gQVdTWFJheS5nZXRTZWdtZW50KClcbiAgICBcbiAgICBpZiAoIXNlZ21lbnQpIHtcbiAgICAgIC8vIE5vIGFjdGl2ZSBzZWdtZW50LCBleGVjdXRlIHdpdGhvdXQgdHJhY2luZ1xuICAgICAgY29uc29sZS53YXJuKGBObyBhY3RpdmUgWC1SYXkgc2VnbWVudCBmb3Igb3BlcmF0aW9uOiAke29wZXJhdGlvbk5hbWV9YClcbiAgICAgIHJldHVybiBvcGVyYXRpb24oKVxuICAgIH1cbiAgICBcbiAgICBjb25zdCBzdWJzZWdtZW50ID0gc2VnbWVudC5hZGROZXdTdWJzZWdtZW50KG9wZXJhdGlvbk5hbWUpXG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIC8vIEFkZCBtZXRhZGF0YVxuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIE9iamVjdC5lbnRyaWVzKG1ldGFkYXRhKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gQWRkIGFzIGFubm90YXRpb24gZm9yIHNlYXJjaGFiaWxpdHlcbiAgICAgICAgICAgIGlmIChbJ2NvcnJlbGF0aW9uSWQnLCAndXNlcklkJywgJ2JyYW5kSWQnXS5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgICAgIHN1YnNlZ21lbnQuYWRkQW5ub3RhdGlvbihrZXksIFN0cmluZyh2YWx1ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBBZGQgYXMgbWV0YWRhdGEgZm9yIGRldGFpbFxuICAgICAgICAgICAgc3Vic2VnbWVudC5hZGRNZXRhZGF0YShrZXksIHZhbHVlKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRXhlY3V0ZSBvcGVyYXRpb25cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9wZXJhdGlvbigpXG4gICAgICBcbiAgICAgIC8vIE1hcmsgYXMgc3VjY2Vzc2Z1bFxuICAgICAgc3Vic2VnbWVudC5jbG9zZSgpXG4gICAgICBcbiAgICAgIHJldHVybiByZXN1bHRcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gQWRkIGVycm9yIHRvIHN1YnNlZ21lbnRcbiAgICAgIHN1YnNlZ21lbnQuYWRkRXJyb3IoZXJyb3IgYXMgRXJyb3IpXG4gICAgICBzdWJzZWdtZW50LmNsb3NlKGVycm9yIGFzIEVycm9yKVxuICAgICAgXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIFRyYWNlIGFuIEhUVFAgcmVxdWVzdFxuICAgKi9cbiAgYXN5bmMgdHJhY2VIdHRwUmVxdWVzdDxUPihcbiAgICB1cmw6IHN0cmluZyxcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBvcGVyYXRpb246ICgpID0+IFByb21pc2U8VD4sXG4gICAgbWV0YWRhdGE/OiBUcmFjZU1ldGFkYXRhXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiB0aGlzLnRyYWNlT3BlcmF0aW9uKGBIVFRQICR7bWV0aG9kfSAke3VybH1gLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpXG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9wZXJhdGlvbigpXG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZVxuICAgICAgICBcbiAgICAgICAgLy8gTG9nIHN1Y2Nlc3NmdWwgcmVxdWVzdFxuICAgICAgICBjb25zb2xlLmxvZyhgSFRUUCAke21ldGhvZH0gJHt1cmx9IC0gJHtkdXJhdGlvbn1tc2AsIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBtZXRhZGF0YT8uY29ycmVsYXRpb25JZCxcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZVxuICAgICAgICBcbiAgICAgICAgLy8gTG9nIGZhaWxlZCByZXF1ZXN0XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEhUVFAgJHttZXRob2R9ICR7dXJsfSAtICR7ZHVyYXRpb259bXMgLSBGQUlMRURgLCB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZDogbWV0YWRhdGE/LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9LCB7XG4gICAgICAuLi5tZXRhZGF0YSxcbiAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgIHVybCxcbiAgICB9KVxuICB9XG4gIFxuICAvKipcbiAgICogVHJhY2UgYSBkYXRhYmFzZSBvcGVyYXRpb25cbiAgICovXG4gIGFzeW5jIHRyYWNlRGF0YWJhc2VPcGVyYXRpb248VD4oXG4gICAgdGFibGVOYW1lOiBzdHJpbmcsXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgcXVlcnk6ICgpID0+IFByb21pc2U8VD4sXG4gICAgbWV0YWRhdGE/OiBUcmFjZU1ldGFkYXRhXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiB0aGlzLnRyYWNlT3BlcmF0aW9uKGBEeW5hbW9EQi4ke29wZXJhdGlvbn1gLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpXG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHF1ZXJ5KClcbiAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lXG4gICAgICAgIFxuICAgICAgICAvLyBMb2cgc3VjY2Vzc2Z1bCBxdWVyeVxuICAgICAgICBjb25zb2xlLmxvZyhgRHluYW1vREIgJHtvcGVyYXRpb259IG9uICR7dGFibGVOYW1lfSAtICR7ZHVyYXRpb259bXNgLCB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZDogbWV0YWRhdGE/LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pXG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWVcbiAgICAgICAgXG4gICAgICAgIC8vIExvZyBmYWlsZWQgcXVlcnlcbiAgICAgICAgY29uc29sZS5lcnJvcihgRHluYW1vREIgJHtvcGVyYXRpb259IG9uICR7dGFibGVOYW1lfSAtICR7ZHVyYXRpb259bXMgLSBGQUlMRURgLCB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZDogbWV0YWRhdGE/LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICB9KVxuICAgICAgICBcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9LCB7XG4gICAgICAuLi5tZXRhZGF0YSxcbiAgICAgIHRhYmxlTmFtZSxcbiAgICAgIG9wZXJhdGlvbixcbiAgICB9KVxuICB9XG4gIFxuICAvKipcbiAgICogQWRkIGN1c3RvbSBhbm5vdGF0aW9uIHRvIGN1cnJlbnQgc2VnbWVudFxuICAgKi9cbiAgYWRkQW5ub3RhdGlvbihrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pOiB2b2lkIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykgcmV0dXJuXG4gICAgXG4gICAgY29uc3Qgc2VnbWVudCA9IEFXU1hSYXkuZ2V0U2VnbWVudCgpXG4gICAgaWYgKHNlZ21lbnQpIHtcbiAgICAgIHNlZ21lbnQuYWRkQW5ub3RhdGlvbihrZXksIFN0cmluZyh2YWx1ZSkpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogQWRkIGN1c3RvbSBtZXRhZGF0YSB0byBjdXJyZW50IHNlZ21lbnRcbiAgICovXG4gIGFkZE1ldGFkYXRhKG5hbWVzcGFjZTogc3RyaW5nLCBrZXk6IHN0cmluZywgdmFsdWU6IGFueSk6IHZvaWQge1xuICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSByZXR1cm5cbiAgICBcbiAgICBjb25zdCBzZWdtZW50ID0gQVdTWFJheS5nZXRTZWdtZW50KClcbiAgICBpZiAoc2VnbWVudCkge1xuICAgICAgc2VnbWVudC5hZGRNZXRhZGF0YShrZXksIHZhbHVlLCBuYW1lc3BhY2UpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IHN1YnNlZ21lbnQgZm9yIGN1c3RvbSBvcGVyYXRpb25zXG4gICAqL1xuICBjcmVhdGVTdWJzZWdtZW50KG5hbWU6IHN0cmluZyk6IFN1YnNlZ21lbnQgfCBudWxsIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykgcmV0dXJuIG51bGxcbiAgICBcbiAgICBjb25zdCBzZWdtZW50ID0gQVdTWFJheS5nZXRTZWdtZW50KClcbiAgICBpZiAoc2VnbWVudCkge1xuICAgICAgcmV0dXJuIHNlZ21lbnQuYWRkTmV3U3Vic2VnbWVudChuYW1lKVxuICAgIH1cbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIFxuICAvKipcbiAgICogR2V0IGNvcnJlbGF0aW9uIElEIGZyb20gY3VycmVudCBzZWdtZW50XG4gICAqL1xuICBnZXRDb3JyZWxhdGlvbklkKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICAgIHJldHVybiBjcnlwdG8ucmFuZG9tVVVJRCgpXG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHNlZ21lbnQgPSBBV1NYUmF5LmdldFNlZ21lbnQoKVxuICAgIGlmIChzZWdtZW50KSB7XG4gICAgICBjb25zdCBhbm5vdGF0aW9ucyA9IChzZWdtZW50IGFzIGFueSkuYW5ub3RhdGlvbnNcbiAgICAgIHJldHVybiBhbm5vdGF0aW9ucz8uY29ycmVsYXRpb25JZFxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBXcmFwIGEgTGFtYmRhIGhhbmRsZXIgd2l0aCBYLVJheSB0cmFjaW5nXG4gICAqL1xuICBzdGF0aWMgdHJhY2VMYW1iZGFIYW5kbGVyPFRFdmVudCwgVFJlc3VsdD4oXG4gICAgaGFuZGxlck5hbWU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoZXZlbnQ6IFRFdmVudCwgY29udGV4dDogYW55KSA9PiBQcm9taXNlPFRSZXN1bHQ+XG4gICk6IChldmVudDogVEV2ZW50LCBjb250ZXh0OiBhbnkpID0+IFByb21pc2U8VFJlc3VsdD4ge1xuICAgIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSB7XG4gICAgICByZXR1cm4gaGFuZGxlclxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gYXN5bmMgKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IGFueSk6IFByb21pc2U8VFJlc3VsdD4gPT4ge1xuICAgICAgY29uc3Qgc2VnbWVudCA9IEFXU1hSYXkuZ2V0U2VnbWVudCgpXG4gICAgICBcbiAgICAgIGlmICghc2VnbWVudCkge1xuICAgICAgICAvLyBObyBzZWdtZW50IGF2YWlsYWJsZSwgZXhlY3V0ZSB3aXRob3V0IHRyYWNpbmdcbiAgICAgICAgcmV0dXJuIGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpXG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIEFkZCBMYW1iZGEgY29udGV4dCB0byBzZWdtZW50XG4gICAgICBzZWdtZW50LmFkZEFubm90YXRpb24oJ2hhbmRsZXInLCBoYW5kbGVyTmFtZSlcbiAgICAgIHNlZ21lbnQuYWRkQW5ub3RhdGlvbigncmVxdWVzdElkJywgY29udGV4dC5yZXF1ZXN0SWQpXG4gICAgICBcbiAgICAgIC8vIEFkZCBldmVudCBtZXRhZGF0YVxuICAgICAgaWYgKChldmVudCBhcyBhbnkpLmNvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgc2VnbWVudC5hZGRBbm5vdGF0aW9uKCdjb3JyZWxhdGlvbklkJywgKGV2ZW50IGFzIGFueSkuY29ycmVsYXRpb25JZClcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgY29udGV4dClcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc2VnbWVudC5hZGRFcnJvcihlcnJvciBhcyBFcnJvcilcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gRXhwb3J0IHNpbmdsZXRvbiBpbnN0YW5jZVxuZXhwb3J0IGNvbnN0IHRyYWNpbmdTZXJ2aWNlID0gVHJhY2luZ1NlcnZpY2UuZ2V0SW5zdGFuY2UoKSJdfQ==