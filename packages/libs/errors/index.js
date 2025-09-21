"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessRuleError = exports.ServiceUnavailableError = exports.InternalServerError = exports.TokenServiceError = exports.ConflictError = exports.NotFoundError = exports.RateLimitError = exports.ValidationError = exports.AuthorizationError = exports.AuthenticationError = exports.APIError = void 0;
// Base error class for all API errors
var APIError = /** @class */ (function (_super) {
    __extends(APIError, _super);
    function APIError(message, code, statusCode, type, details, correlationId, isRetryable) {
        if (type === void 0) { type = 'API_ERROR'; }
        if (isRetryable === void 0) { isRetryable = false; }
        var _this = _super.call(this, message) || this;
        _this.code = code;
        _this.statusCode = statusCode;
        _this.type = type;
        _this.details = details;
        _this.correlationId = correlationId;
        _this.isRetryable = isRetryable;
        _this.name = _this.constructor.name;
        return _this;
    }
    APIError.prototype.toJSON = function () {
        return {
            error: {
                message: this.message,
                code: this.code,
                type: this.type,
                details: this.details,
                timestamp: new Date().toISOString(),
                correlationId: this.correlationId,
            },
        };
    };
    return APIError;
}(Error));
exports.APIError = APIError;
// Authentication and authorization errors
var AuthenticationError = /** @class */ (function (_super) {
    __extends(AuthenticationError, _super);
    function AuthenticationError(message, details) {
        if (message === void 0) { message = 'Authentication required'; }
        return _super.call(this, message, 'AUTHENTICATION_REQUIRED', 401, 'AUTH_ERROR', details) || this;
    }
    return AuthenticationError;
}(APIError));
exports.AuthenticationError = AuthenticationError;
var AuthorizationError = /** @class */ (function (_super) {
    __extends(AuthorizationError, _super);
    function AuthorizationError(message, details) {
        if (message === void 0) { message = 'Insufficient permissions'; }
        return _super.call(this, message, 'INSUFFICIENT_PERMISSIONS', 403, 'AUTH_ERROR', details) || this;
    }
    return AuthorizationError;
}(APIError));
exports.AuthorizationError = AuthorizationError;
// Validation errors
var ValidationError = /** @class */ (function (_super) {
    __extends(ValidationError, _super);
    function ValidationError(message, details) {
        return _super.call(this, message, 'VALIDATION_ERROR', 400, 'VALIDATION_ERROR', details) || this;
    }
    return ValidationError;
}(APIError));
exports.ValidationError = ValidationError;
// Rate limiting errors
var RateLimitError = /** @class */ (function (_super) {
    __extends(RateLimitError, _super);
    function RateLimitError(retryAfter, message) {
        var _this = _super.call(this, message || "Rate limit exceeded. Try again in ".concat(retryAfter, " seconds."), 'RATE_LIMIT_EXCEEDED', 429, 'RATE_LIMIT_ERROR', { retryAfter: retryAfter }, undefined, true) || this;
        _this.retryAfter = retryAfter;
        return _this;
    }
    return RateLimitError;
}(APIError));
exports.RateLimitError = RateLimitError;
// Resource errors
var NotFoundError = /** @class */ (function (_super) {
    __extends(NotFoundError, _super);
    function NotFoundError(resource, identifier) {
        var message = identifier ? "".concat(resource, " '").concat(identifier, "' not found") : "".concat(resource, " not found");
        return _super.call(this, message, 'RESOURCE_NOT_FOUND', 404, 'RESOURCE_ERROR', {
            resource: resource,
            identifier: identifier,
        }) || this;
    }
    return NotFoundError;
}(APIError));
exports.NotFoundError = NotFoundError;
var ConflictError = /** @class */ (function (_super) {
    __extends(ConflictError, _super);
    function ConflictError(message, details) {
        return _super.call(this, message, 'RESOURCE_CONFLICT', 409, 'RESOURCE_ERROR', details) || this;
    }
    return ConflictError;
}(APIError));
exports.ConflictError = ConflictError;
// Token service specific errors
var TokenServiceError = /** @class */ (function (_super) {
    __extends(TokenServiceError, _super);
    function TokenServiceError(message, code, statusCode, isRetryable) {
        var _this = _super.call(this, message, code, statusCode || 500, 'TOKEN_SERVICE_ERROR', undefined, undefined, isRetryable) || this;
        _this.name = 'TokenServiceError';
        return _this;
    }
    return TokenServiceError;
}(APIError));
exports.TokenServiceError = TokenServiceError;
// Server errors
var InternalServerError = /** @class */ (function (_super) {
    __extends(InternalServerError, _super);
    function InternalServerError(message, details) {
        if (message === void 0) { message = 'Internal server error'; }
        return _super.call(this, message, 'INTERNAL_SERVER_ERROR', 500, 'SERVER_ERROR', details, undefined, true) || this;
    }
    return InternalServerError;
}(APIError));
exports.InternalServerError = InternalServerError;
var ServiceUnavailableError = /** @class */ (function (_super) {
    __extends(ServiceUnavailableError, _super);
    function ServiceUnavailableError(service, details) {
        return _super.call(this, "".concat(service, " service is currently unavailable"), 'SERVICE_UNAVAILABLE', 503, 'SERVICE_ERROR', __assign({ service: service }, details), undefined, true) || this;
    }
    return ServiceUnavailableError;
}(APIError));
exports.ServiceUnavailableError = ServiceUnavailableError;
// Business logic errors
var BusinessRuleError = /** @class */ (function (_super) {
    __extends(BusinessRuleError, _super);
    function BusinessRuleError(message, rule, details) {
        return _super.call(this, message, 'BUSINESS_RULE_VIOLATION', 422, 'BUSINESS_ERROR', __assign({ rule: rule }, details)) || this;
    }
    return BusinessRuleError;
}(APIError));
exports.BusinessRuleError = BusinessRuleError;
