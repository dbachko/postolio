# Campaign Creation Error Diagnosis

Based on the 400 error you're experiencing, here are the most likely causes and solutions:

## Common Issues and Solutions

### 1. **Missing or Empty Required Fields**
The campaign configuration requires all these fields:
- `name` (non-empty string)
- `brandId` (valid brand ID)
- `duration.start` and `duration.end` (valid dates, end > start)
- `frequency` (must be: `'daily'`, `'every2days'`, or `'3weekly'`)
- `themes` (array with at least one theme)
- `style` (non-empty string)
- `postingTime` (format: `'HH:MM'`, e.g., `'14:00'`)

### 2. **Invalid Frequency Value**
Check that the frequency dropdown is sending one of these exact values:
- `'daily'`
- `'every2days'`
- `'3weekly'`

### 3. **Invalid Posting Time Format**
The posting time must be in `HH:MM` format:
- ✅ Correct: `'14:00'`, `'09:30'`, `'23:15'`
- ❌ Incorrect: `'2:00'`, `'14:0'`, `'2pm'`

### 4. **Date Issues**
- Start date cannot be in the past
- End date must be after start date
- Dates should be properly formatted ISO strings

### 5. **Empty Themes Array**
At least one theme must be selected or added.

## Quick Debug Steps

1. **Check Browser Network Tab:**
   - Open Developer Tools → Network tab
   - Try creating a campaign
   - Look at the POST request to `/campaign/configure`
   - Check the request payload for missing/invalid fields

2. **Check Server Response:**
   - The 400 response should include validation error details
   - Look for `error: 'Validation failed'` and `details: [...]` array

3. **Common Frontend Issues:**
   - Empty frequency when form loads (should default to a valid value)
   - Incorrect posting time format from time input
   - Empty themes array if no themes are selected
   - Missing brand ID if brand switching has issues

## Temporary Workaround

If the issue persists, you can temporarily log the exact request being sent by adding this to the frontend campaign submission:

```javascript
console.log('Campaign config being sent:', JSON.stringify(campaignConfig, null, 2))
```

This will show you exactly what data is being sent to help identify the validation issue.

## Expected Valid Payload Example

```json
{
  "name": "Neural AI Campaign",
  "brandId": "cmdr0c5qf0002iqy2dvgnyx7v",
  "duration": {
    "start": "2025-08-01T00:00:00.000Z",
    "end": "2025-08-31T00:00:00.000Z"
  },
  "frequency": "daily",
  "themes": ["neural networks", "AI innovation"],
  "style": "modern",
  "postingTime": "14:00",
  "priority": 2
}
```

The most common issue is usually an empty or invalid `frequency` field, so check that first!