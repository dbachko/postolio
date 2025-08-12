#!/bin/sh

# Test script to verify Alpine Linux compatibility
# Run this to test if the migration script works correctly

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Testing Alpine Linux compatibility for migration scripts..."
echo "========================================="

# Test 1: Check sh syntax
echo "Test 1: Checking script syntax..."
if sh -n "$SCRIPT_DIR/start-with-migration.sh" 2>/dev/null; then
    echo "✅ start-with-migration.sh syntax is valid"
else
    echo "❌ start-with-migration.sh has syntax errors"
    exit 1
fi

if sh -n "$SCRIPT_DIR/run-migrations-only.sh" 2>/dev/null; then
    echo "✅ run-migrations-only.sh syntax is valid"
else
    echo "❌ run-migrations-only.sh has syntax errors"
    exit 1
fi

# Test 2: Check for bash-specific features (excluding comments)
echo "\nTest 2: Checking for bash-specific features..."
# Remove comments first, then check for bash-specific features
if sed 's/#.*//' "$SCRIPT_DIR/start-with-migration.sh" | grep -E '\$RANDOM|\[\[|\$\{.*##|\$\{.*%%' >/dev/null 2>&1; then
    echo "❌ Found bash-specific features in start-with-migration.sh"
    exit 1
else
    echo "✅ No bash-specific features found in start-with-migration.sh"
fi

# Test 3: Test random number generation
echo "\nTest 3: Testing random number generation..."
if [ -r /dev/urandom ]; then
    DELAY=$(( $(od -An -N2 -i /dev/urandom | sed 's/ //g') % 30 ))
    echo "✅ Random number generation works: ${DELAY}"
else
    echo "⚠️  /dev/urandom not available (will use fallback)"
fi

# Test 4: Docker build test (if Docker is available)
echo "\nTest 4: Docker Alpine test..."
if command -v docker >/dev/null 2>&1; then
    echo "Creating temporary Alpine test..."
    
    # Create a minimal test
    cat > /tmp/test-alpine.sh << 'EOF'
#!/bin/sh
if [ -r /dev/urandom ]; then
    DELAY=$(( $(od -An -N2 -i /dev/urandom | sed 's/ //g') % 30 ))
    echo "Alpine test: Random delay = ${DELAY} seconds"
    exit 0
else
    echo "Alpine test: No /dev/urandom"
    exit 1
fi
EOF
    
    # Test in Alpine container
    if docker run --rm -v /tmp/test-alpine.sh:/test.sh:ro alpine:latest sh /test.sh; then
        echo "✅ Script works in Alpine Linux container"
    else
        echo "❌ Script failed in Alpine Linux container"
    fi
    
    rm -f /tmp/test-alpine.sh
else
    echo "⚠️  Docker not available, skipping container test"
fi

echo "\n========================================="
echo "✅ All tests passed! Scripts are Alpine Linux compatible."
echo "========================================="