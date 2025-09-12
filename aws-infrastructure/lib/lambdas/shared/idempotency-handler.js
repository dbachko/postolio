"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyHandler = exports.IdempotencyError = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class IdempotencyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'IdempotencyError';
    }
}
exports.IdempotencyError = IdempotencyError;
class IdempotencyHandler {
    docClient;
    options;
    keyField;
    ttlSeconds;
    constructor(docClient, options) {
        this.docClient = docClient;
        this.options = options;
        this.keyField = options.keyField || 'idempotencyKey';
        this.ttlSeconds = options.ttlSeconds || 86400; // 24 hours default
    }
    async checkAndRecord(key, data) {
        try {
            // Check if key exists
            const getResult = await this.docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: this.options.tableName,
                Key: { [this.keyField]: key },
            }));
            if (getResult.Item) {
                // Key exists, check if it's the same request
                if (JSON.stringify(getResult.Item.data) === JSON.stringify(data)) {
                    // Same request, return success
                    return false; // Don't process again
                }
                else {
                    // Different request with same key
                    throw new IdempotencyError(`Different request with same idempotency key: ${key}`);
                }
            }
            // Record new request
            const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
            await this.docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: this.options.tableName,
                Item: {
                    [this.keyField]: key,
                    data,
                    createdAt: new Date().toISOString(),
                    ttl,
                },
                ConditionExpression: `attribute_not_exists(${this.keyField})`,
            }));
            return true; // Process this request
        }
        catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
                // Race condition - another process recorded the key
                return false; // Don't process again
            }
            throw error;
        }
    }
    async markComplete(key, result) {
        const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.options.tableName,
            Item: {
                [this.keyField]: key,
                result,
                completedAt: new Date().toISOString(),
                ttl,
            },
        }));
    }
}
exports.IdempotencyHandler = IdempotencyHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWRlbXBvdGVuY3ktaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImlkZW1wb3RlbmN5LWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsd0RBQXNGO0FBRXRGLE1BQWEsZ0JBQWlCLFNBQVEsS0FBSztJQUN6QyxZQUFZLE9BQWU7UUFDekIsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyxrQkFBa0IsQ0FBQTtJQUNoQyxDQUFDO0NBQ0Y7QUFMRCw0Q0FLQztBQVFELE1BQWEsa0JBQWtCO0lBS25CO0lBQ0E7SUFMRixRQUFRLENBQVE7SUFDaEIsVUFBVSxDQUFRO0lBRTFCLFlBQ1UsU0FBaUMsRUFDakMsT0FBMkI7UUFEM0IsY0FBUyxHQUFULFNBQVMsQ0FBd0I7UUFDakMsWUFBTyxHQUFQLE9BQU8sQ0FBb0I7UUFFbkMsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLGdCQUFnQixDQUFBO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUEsQ0FBQyxtQkFBbUI7SUFDbkUsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsR0FBVyxFQUFFLElBQVM7UUFDekMsSUFBSSxDQUFDO1lBQ0gsc0JBQXNCO1lBQ3RCLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO2dCQUN6RCxTQUFTLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTO2dCQUNqQyxHQUFHLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxHQUFHLEVBQUU7YUFDOUIsQ0FBQyxDQUFDLENBQUE7WUFFSCxJQUFJLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDbkIsNkNBQTZDO2dCQUM3QyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQ2pFLCtCQUErQjtvQkFDL0IsT0FBTyxLQUFLLENBQUEsQ0FBQyxzQkFBc0I7Z0JBQ3JDLENBQUM7cUJBQU0sQ0FBQztvQkFDTixrQ0FBa0M7b0JBQ2xDLE1BQU0sSUFBSSxnQkFBZ0IsQ0FBQyxnREFBZ0QsR0FBRyxFQUFFLENBQUMsQ0FBQTtnQkFDbkYsQ0FBQztZQUNILENBQUM7WUFFRCxxQkFBcUI7WUFDckIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQTtZQUMzRCxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztnQkFDdkMsU0FBUyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUztnQkFDakMsSUFBSSxFQUFFO29CQUNKLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEdBQUc7b0JBQ3BCLElBQUk7b0JBQ0osU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO29CQUNuQyxHQUFHO2lCQUNKO2dCQUNELG1CQUFtQixFQUFFLHdCQUF3QixJQUFJLENBQUMsUUFBUSxHQUFHO2FBQzlELENBQUMsQ0FBQyxDQUFBO1lBRUgsT0FBTyxJQUFJLENBQUEsQ0FBQyx1QkFBdUI7UUFDckMsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLGlDQUFpQyxFQUFFLENBQUM7Z0JBQ3JELG9EQUFvRDtnQkFDcEQsT0FBTyxLQUFLLENBQUEsQ0FBQyxzQkFBc0I7WUFDckMsQ0FBQztZQUNELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQVcsRUFBRSxNQUFXO1FBQ3pDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUE7UUFDM0QsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7WUFDdkMsU0FBUyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUztZQUNqQyxJQUFJLEVBQUU7Z0JBQ0osQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsR0FBRztnQkFDcEIsTUFBTTtnQkFDTixXQUFXLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7Z0JBQ3JDLEdBQUc7YUFDSjtTQUNGLENBQUMsQ0FBQyxDQUFBO0lBQ0wsQ0FBQztDQUNGO0FBbEVELGdEQWtFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInXG5cbmV4cG9ydCBjbGFzcyBJZGVtcG90ZW5jeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJZGVtcG90ZW5jeUVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWRlbXBvdGVuY3lPcHRpb25zIHtcbiAgdGFibGVOYW1lOiBzdHJpbmdcbiAga2V5RmllbGQ/OiBzdHJpbmdcbiAgdHRsU2Vjb25kcz86IG51bWJlclxufVxuXG5leHBvcnQgY2xhc3MgSWRlbXBvdGVuY3lIYW5kbGVyIHtcbiAgcHJpdmF0ZSBrZXlGaWVsZDogc3RyaW5nXG4gIHByaXZhdGUgdHRsU2Vjb25kczogbnVtYmVyXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBkb2NDbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsXG4gICAgcHJpdmF0ZSBvcHRpb25zOiBJZGVtcG90ZW5jeU9wdGlvbnNcbiAgKSB7XG4gICAgdGhpcy5rZXlGaWVsZCA9IG9wdGlvbnMua2V5RmllbGQgfHwgJ2lkZW1wb3RlbmN5S2V5J1xuICAgIHRoaXMudHRsU2Vjb25kcyA9IG9wdGlvbnMudHRsU2Vjb25kcyB8fCA4NjQwMCAvLyAyNCBob3VycyBkZWZhdWx0XG4gIH1cblxuICBhc3luYyBjaGVja0FuZFJlY29yZChrZXk6IHN0cmluZywgZGF0YTogYW55KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIENoZWNrIGlmIGtleSBleGlzdHNcbiAgICAgIGNvbnN0IGdldFJlc3VsdCA9IGF3YWl0IHRoaXMuZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IHRoaXMub3B0aW9ucy50YWJsZU5hbWUsXG4gICAgICAgIEtleTogeyBbdGhpcy5rZXlGaWVsZF06IGtleSB9LFxuICAgICAgfSkpXG5cbiAgICAgIGlmIChnZXRSZXN1bHQuSXRlbSkge1xuICAgICAgICAvLyBLZXkgZXhpc3RzLCBjaGVjayBpZiBpdCdzIHRoZSBzYW1lIHJlcXVlc3RcbiAgICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KGdldFJlc3VsdC5JdGVtLmRhdGEpID09PSBKU09OLnN0cmluZ2lmeShkYXRhKSkge1xuICAgICAgICAgIC8vIFNhbWUgcmVxdWVzdCwgcmV0dXJuIHN1Y2Nlc3NcbiAgICAgICAgICByZXR1cm4gZmFsc2UgLy8gRG9uJ3QgcHJvY2VzcyBhZ2FpblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIERpZmZlcmVudCByZXF1ZXN0IHdpdGggc2FtZSBrZXlcbiAgICAgICAgICB0aHJvdyBuZXcgSWRlbXBvdGVuY3lFcnJvcihgRGlmZmVyZW50IHJlcXVlc3Qgd2l0aCBzYW1lIGlkZW1wb3RlbmN5IGtleTogJHtrZXl9YClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBSZWNvcmQgbmV3IHJlcXVlc3RcbiAgICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgdGhpcy50dGxTZWNvbmRzXG4gICAgICBhd2FpdCB0aGlzLmRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm9wdGlvbnMudGFibGVOYW1lLFxuICAgICAgICBJdGVtOiB7XG4gICAgICAgICAgW3RoaXMua2V5RmllbGRdOiBrZXksXG4gICAgICAgICAgZGF0YSxcbiAgICAgICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB0dGwsXG4gICAgICAgIH0sXG4gICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246IGBhdHRyaWJ1dGVfbm90X2V4aXN0cygke3RoaXMua2V5RmllbGR9KWAsXG4gICAgICB9KSlcblxuICAgICAgcmV0dXJuIHRydWUgLy8gUHJvY2VzcyB0aGlzIHJlcXVlc3RcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAoZXJyb3IubmFtZSA9PT0gJ0NvbmRpdGlvbmFsQ2hlY2tGYWlsZWRFeGNlcHRpb24nKSB7XG4gICAgICAgIC8vIFJhY2UgY29uZGl0aW9uIC0gYW5vdGhlciBwcm9jZXNzIHJlY29yZGVkIHRoZSBrZXlcbiAgICAgICAgcmV0dXJuIGZhbHNlIC8vIERvbid0IHByb2Nlc3MgYWdhaW5cbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbWFya0NvbXBsZXRlKGtleTogc3RyaW5nLCByZXN1bHQ6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgdGhpcy50dGxTZWNvbmRzXG4gICAgYXdhaXQgdGhpcy5kb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHRoaXMub3B0aW9ucy50YWJsZU5hbWUsXG4gICAgICBJdGVtOiB7XG4gICAgICAgIFt0aGlzLmtleUZpZWxkXToga2V5LFxuICAgICAgICByZXN1bHQsXG4gICAgICAgIGNvbXBsZXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHR0bCxcbiAgICAgIH0sXG4gICAgfSkpXG4gIH1cbn1cbiJdfQ==