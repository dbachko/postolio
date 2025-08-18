#!/bin/bash

# CloudWatch Monitoring Setup Script
# Configures comprehensive monitoring for production Postolio deployment

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ENVIRONMENT="production"
export NAMESPACE="Postolio/Production"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Function to create CloudWatch dashboard
create_dashboard() {
    log_info "Creating CloudWatch dashboard..."
    
    cat > dashboard.json <<'EOF'
{
    "widgets": [
        {
            "type": "metric",
            "x": 0,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "Postolio/Production", "APIRequests", { "stat": "Sum", "label": "Total Requests" } ],
                    [ ".", "APIErrors", { "stat": "Sum", "label": "Errors", "yAxis": "right" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "API Request Volume",
                "period": 300,
                "yAxis": {
                    "left": {
                        "min": 0
                    },
                    "right": {
                        "min": 0
                    }
                }
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "Postolio/Production", "APILatency", { "stat": "Average", "label": "Avg Latency" } ],
                    [ "...", { "stat": "p50", "label": "P50" } ],
                    [ "...", { "stat": "p95", "label": "P95" } ],
                    [ "...", { "stat": "p99", "label": "P99" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "API Latency (ms)",
                "period": 300,
                "yAxis": {
                    "left": {
                        "min": 0
                    }
                }
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 6,
            "width": 8,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "Postolio/Production", "SchedulesCreated", { "stat": "Sum" } ],
                    [ ".", "SchedulesExecuted", { "stat": "Sum" } ],
                    [ ".", "SchedulesFailed", { "stat": "Sum" } ],
                    [ ".", "SchedulesCancelled", { "stat": "Sum" } ]
                ],
                "view": "timeSeries",
                "stacked": true,
                "region": "us-east-1",
                "title": "Schedule Operations",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 8,
            "y": 6,
            "width": 8,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "Postolio/Production", "ContentPublished", { "stat": "Sum", "label": "Published" } ],
                    [ ".", "PublishingErrors", { "stat": "Sum", "label": "Failed" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "Content Publishing",
                "period": 300,
                "yAxis": {
                    "left": {
                        "min": 0
                    }
                }
            }
        },
        {
            "type": "metric",
            "x": 16,
            "y": 6,
            "width": 8,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "Postolio/Production", "DeliveryAccuracy", { "stat": "Average", "label": "On-Time %" } ]
                ],
                "view": "singleValue",
                "region": "us-east-1",
                "title": "Delivery Accuracy",
                "period": 3600
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 12,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/Lambda", "Invocations", { "dimensions": { "FunctionName": "content-scheduler-api" } } ],
                    [ ".", "Errors", { "dimensions": { "FunctionName": "content-scheduler-api" }, "yAxis": "right" } ],
                    [ ".", "Throttles", { "dimensions": { "FunctionName": "content-scheduler-api" }, "yAxis": "right" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "Lambda Performance",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 12,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/Lambda", "Duration", { "dimensions": { "FunctionName": "content-scheduler-api" }, "stat": "Average" } ],
                    [ "...", { "stat": "Maximum" } ],
                    [ ".", "ConcurrentExecutions", { "dimensions": { "FunctionName": "content-scheduler-api" }, "stat": "Maximum", "yAxis": "right" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "Lambda Duration & Concurrency",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 18,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/DynamoDB", "ConsumedReadCapacityUnits", { "dimensions": { "TableName": "content-scheduler-schedules" }, "stat": "Sum" } ],
                    [ ".", "ConsumedWriteCapacityUnits", { "dimensions": { "TableName": "content-scheduler-schedules" }, "stat": "Sum" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "DynamoDB Capacity",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 18,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/DynamoDB", "UserErrors", { "dimensions": { "TableName": "content-scheduler-schedules" }, "stat": "Sum" } ],
                    [ ".", "SystemErrors", { "dimensions": { "TableName": "content-scheduler-schedules" }, "stat": "Sum" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "us-east-1",
                "title": "DynamoDB Errors",
                "period": 300,
                "yAxis": {
                    "left": {
                        "min": 0
                    }
                }
            }
        },
        {
            "type": "log",
            "x": 0,
            "y": 24,
            "width": 24,
            "height": 6,
            "properties": {
                "query": "SOURCE '/aws/lambda/content-scheduler-api'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc\n| limit 20",
                "region": "us-east-1",
                "title": "Recent Errors",
                "queryLanguage": "kusto"
            }
        }
    ]
}
EOF
    
    aws cloudwatch put-dashboard \
        --dashboard-name "Postolio-Production" \
        --dashboard-body file://dashboard.json
    
    rm dashboard.json
    
    log_success "Dashboard created: Postolio-Production"
}

# Function to create SNS topic for alerts
create_sns_topic() {
    log_info "Creating SNS topic for alerts..."
    
    # Create topic
    SNS_TOPIC_ARN=$(aws sns create-topic \
        --name "postolio-production-alerts" \
        --attributes DisplayName="Postolio Production Alerts" \
        --tags "Key=Environment,Value=${ENVIRONMENT}" "Key=Application,Value=Postolio" \
        --query 'TopicArn' \
        --output text)
    
    log_success "SNS Topic created: ${SNS_TOPIC_ARN}"
    
    # Add email subscriptions with validation
    read -p "Enter email for alerts (or press Enter to skip): " alert_email
    if [ -n "${alert_email}" ]; then
        # Validate email format
        if [[ ! "${alert_email}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
            log_warning "Invalid email format: ${alert_email}"
            alert_email=""
        else
            aws sns subscribe \
                --topic-arn "${SNS_TOPIC_ARN}" \
                --protocol email \
                --notification-endpoint "${alert_email}"
            
            log_info "Subscription pending confirmation for: ${alert_email}"
        fi
    fi
    
    # Add SMS subscription (optional)
    read -p "Enter phone number for SMS alerts (format: +1234567890, or press Enter to skip): " alert_phone
    if [ -n "${alert_phone}" ]; then
        aws sns subscribe \
            --topic-arn "${SNS_TOPIC_ARN}" \
            --protocol sms \
            --notification-endpoint "${alert_phone}"
        
        log_info "SMS subscription added: ${alert_phone}"
    fi
    
    echo "${SNS_TOPIC_ARN}"
}

# Function to create CloudWatch alarms
create_alarms() {
    log_info "Creating CloudWatch alarms..."
    
    # Get SNS topic ARN
    SNS_TOPIC_ARN=$(aws sns list-topics \
        --query "Topics[?contains(TopicArn, 'postolio-production-alerts')].TopicArn | [0]" \
        --output text)
    
    if [ -z "${SNS_TOPIC_ARN}" ] || [ "${SNS_TOPIC_ARN}" == "None" ]; then
        SNS_TOPIC_ARN=$(create_sns_topic)
    fi
    
    # API Error Rate Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-High-Error-Rate" \
        --alarm-description "Alert when API error rate exceeds 5%" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metric-name "APIErrors" \
        --namespace "${NAMESPACE}" \
        --statistic "Average" \
        --period 300 \
        --threshold 5 \
        --comparison-operator GreaterThanThreshold \
        --datapoints-to-alarm 2 \
        --evaluation-periods 3 \
        --treat-missing-data notBreaching
    
    log_success "Created alarm: High Error Rate"
    
    # High Latency Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-High-Latency" \
        --alarm-description "Alert when P95 latency exceeds 2 seconds" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metric-name "APILatency" \
        --namespace "${NAMESPACE}" \
        --extended-statistic "p95" \
        --period 300 \
        --threshold 2000 \
        --comparison-operator GreaterThanThreshold \
        --datapoints-to-alarm 2 \
        --evaluation-periods 3 \
        --treat-missing-data notBreaching
    
    log_success "Created alarm: High Latency"
    
    # Schedule Failure Rate Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-Schedule-Failures" \
        --alarm-description "Alert when schedule failure rate exceeds 10%" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metrics '[
            {
                "Id": "e1",
                "Expression": "(m2/m1)*100",
                "Label": "Failure Rate",
                "ReturnData": true
            },
            {
                "Id": "m1",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "'${NAMESPACE}'",
                        "MetricName": "SchedulesExecuted"
                    },
                    "Period": 300,
                    "Stat": "Sum"
                },
                "ReturnData": false
            },
            {
                "Id": "m2",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "'${NAMESPACE}'",
                        "MetricName": "SchedulesFailed"
                    },
                    "Period": 300,
                    "Stat": "Sum"
                },
                "ReturnData": false
            }
        ]' \
        --threshold 10 \
        --comparison-operator GreaterThanThreshold \
        --datapoints-to-alarm 2 \
        --evaluation-periods 3
    
    log_success "Created alarm: Schedule Failures"
    
    # Lambda Throttling Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-Lambda-Throttles" \
        --alarm-description "Alert when Lambda throttling occurs" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metric-name "Throttles" \
        --namespace "AWS/Lambda" \
        --dimensions Name=FunctionName,Value=content-scheduler-api \
        --statistic "Sum" \
        --period 300 \
        --threshold 10 \
        --comparison-operator GreaterThanThreshold \
        --datapoints-to-alarm 1 \
        --evaluation-periods 1
    
    log_success "Created alarm: Lambda Throttles"
    
    # DynamoDB Throttling Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-DynamoDB-Throttles" \
        --alarm-description "Alert when DynamoDB throttling occurs" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metric-name "UserErrors" \
        --namespace "AWS/DynamoDB" \
        --dimensions Name=TableName,Value=content-scheduler-schedules \
        --statistic "Sum" \
        --period 300 \
        --threshold 50 \
        --comparison-operator GreaterThanThreshold \
        --datapoints-to-alarm 1 \
        --evaluation-periods 2
    
    log_success "Created alarm: DynamoDB Throttles"
    
    # Delivery Accuracy Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "Postolio-Prod-Delivery-Accuracy" \
        --alarm-description "Alert when delivery accuracy drops below 99%" \
        --actions-enabled \
        --alarm-actions "${SNS_TOPIC_ARN}" \
        --metric-name "DeliveryAccuracy" \
        --namespace "${NAMESPACE}" \
        --statistic "Average" \
        --period 3600 \
        --threshold 99 \
        --comparison-operator LessThanThreshold \
        --datapoints-to-alarm 2 \
        --evaluation-periods 3 \
        --treat-missing-data notBreaching
    
    log_success "Created alarm: Delivery Accuracy"
}

# Function to create custom metrics
create_custom_metrics() {
    log_info "Setting up custom metrics collection..."
    
    # Create metric filter for API requests
    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/content-scheduler-api" \
        --filter-name "APIRequests" \
        --filter-pattern '[timestamp, request_id, level, message = "*API Request*", ...]' \
        --metric-transformations \
            metricName=APIRequests,metricNamespace=${NAMESPACE},metricValue=1
    
    # Create metric filter for API errors
    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/content-scheduler-api" \
        --filter-name "APIErrors" \
        --filter-pattern '[timestamp, request_id, level = "ERROR", ...]' \
        --metric-transformations \
            metricName=APIErrors,metricNamespace=${NAMESPACE},metricValue=1
    
    # Create metric filter for schedule operations
    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/schedule-executor" \
        --filter-name "ScheduleOperations" \
        --filter-pattern '[timestamp, request_id, level, message = "*Schedule executed*", ...]' \
        --metric-transformations \
            metricName=SchedulesExecuted,metricNamespace=${NAMESPACE},metricValue=1
    
    log_success "Custom metrics configured"
}

# Function to create CloudWatch Insights queries
create_insights_queries() {
    log_info "Creating CloudWatch Insights queries..."
    
    # Save common queries
    cat > insights-queries.json <<'EOF'
{
    "queries": [
        {
            "name": "API Error Analysis",
            "query": "fields @timestamp, @message, error.message, error.stack | filter @message like /ERROR/ | stats count() by error.message | sort count() desc"
        },
        {
            "name": "Slow API Requests",
            "query": "fields @timestamp, duration, path, method | filter duration > 2000 | sort duration desc | limit 100"
        },
        {
            "name": "Schedule Execution Status",
            "query": "fields @timestamp, scheduleId, status, platform | filter @message like /Schedule/ | stats count() by status"
        },
        {
            "name": "Platform Publishing Errors",
            "query": "fields @timestamp, platform, error, contentId | filter @message like /Publishing failed/ | stats count() by platform, error"
        },
        {
            "name": "User Activity",
            "query": "fields @timestamp, userId, action, brandId | filter @message like /User action/ | stats count() by userId, action | sort count() desc"
        },
        {
            "name": "Lambda Cold Starts",
            "query": "fields @timestamp, @initDuration | filter @type = 'REPORT' and @initDuration > 0 | stats avg(@initDuration), max(@initDuration), count()"
        }
    ]
}
EOF
    
    log_success "Insights queries saved to: insights-queries.json"
}

# Function to setup X-Ray tracing
setup_xray_tracing() {
    log_info "Configuring X-Ray tracing..."
    
    # Enable X-Ray for Lambda functions
    local functions=(
        "content-scheduler-api"
        "schedule-executor"
        "content-publisher"
        "metrics-collector"
    )
    
    for func in "${functions[@]}"; do
        aws lambda update-function-configuration \
            --function-name "${func}" \
            --tracing-config Mode=Active \
            2>/dev/null || log_warning "Function ${func} not found"
    done
    
    # Create X-Ray sampling rule
    cat > sampling-rule.json <<'EOF'
{
    "version": 2,
    "default": {
        "fixed_target": 1,
        "rate": 0.1
    },
    "rules": [
        {
            "description": "High priority API endpoints",
            "service_name": "*",
            "http_method": "POST",
            "url_path": "/schedules*",
            "fixed_target": 2,
            "rate": 0.5
        }
    ]
}
EOF
    
    aws xray put-sampling-rule \
        --cli-input-json file://sampling-rule.json \
        2>/dev/null || log_warning "X-Ray sampling rule already exists"
    
    rm sampling-rule.json
    
    log_success "X-Ray tracing configured"
}

# Function to create monitoring documentation
create_monitoring_docs() {
    log_info "Creating monitoring documentation..."
    
    cat > monitoring-guide.md <<'EOF'
# Postolio Production Monitoring Guide

## Dashboard Access
- **CloudWatch Dashboard**: [Postolio-Production](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=Postolio-Production)
- **X-Ray Service Map**: [Service Map](https://console.aws.amazon.com/xray/home?region=us-east-1#/service-map)
- **CloudWatch Logs**: [Log Groups](https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups)

## Key Metrics

### Business Metrics
- `APIRequests`: Total API request volume
- `SchedulesCreated`: New schedules created
- `SchedulesExecuted`: Schedules successfully processed
- `ContentPublished`: Content successfully published
- `DeliveryAccuracy`: Percentage of on-time deliveries

### Performance Metrics
- `APILatency`: API response time (P50, P95, P99)
- `Lambda/Duration`: Function execution time
- `Lambda/ConcurrentExecutions`: Active Lambda instances

### Error Metrics
- `APIErrors`: API error count
- `SchedulesFailed`: Failed schedule executions
- `PublishingErrors`: Failed content publications
- `Lambda/Errors`: Lambda function errors

## Alarm Thresholds
- **High Error Rate**: > 5% API errors
- **High Latency**: P95 > 2 seconds
- **Schedule Failures**: > 10% failure rate
- **Lambda Throttles**: > 10 per 5 minutes
- **DynamoDB Throttles**: > 50 per 5 minutes
- **Delivery Accuracy**: < 99%

## Response Procedures
See production runbook for detailed response procedures.

## Monitoring Queries

### Find Slow Requests
```
fields @timestamp, duration, path
| filter duration > 2000
| sort duration desc
| limit 20
```

### Error Analysis
```
fields @timestamp, error.message
| filter @message like /ERROR/
| stats count() by error.message
| sort count() desc
```

### Schedule Status
```
fields @timestamp, scheduleId, status
| filter @message like /Schedule/
| stats count() by status
```
EOF
    
    log_success "Documentation created: monitoring-guide.md"
}

# Main execution
main() {
    log_info "=========================================="
    log_info "CloudWatch Monitoring Setup"
    log_info "Environment: ${ENVIRONMENT}"
    log_info "Region: ${AWS_REGION}"
    log_info "=========================================="
    
    # Create dashboard
    create_dashboard
    
    # Create alarms
    create_alarms
    
    # Setup custom metrics
    create_custom_metrics
    
    # Configure X-Ray
    setup_xray_tracing
    
    # Create Insights queries
    create_insights_queries
    
    # Generate documentation
    create_monitoring_docs
    
    log_success "=========================================="
    log_success "Monitoring setup complete!"
    log_success "Dashboard: https://console.aws.amazon.com/cloudwatch"
    log_success "=========================================="
    
    echo ""
    log_info "Next steps:"
    echo "1. Confirm SNS email subscriptions"
    echo "2. Test alarms with synthetic traffic"
    echo "3. Review dashboard layout"
    echo "4. Configure additional metrics as needed"
}

# Run main
main "$@"