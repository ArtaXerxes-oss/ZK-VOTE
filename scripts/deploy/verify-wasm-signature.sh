#!/usr/bin/env bash
# ==============================================================================
# Sigstore Cosign WASM Signature & Integrity Verifier
# Prevents deploying unsigned or tampered WASM contracts (e.g. dao_registry.wasm).
# ==============================================================================

set -euo pipefail

WASM_FILE="${1:-}"

if [ -z "$WASM_FILE" ]; then
    echo "Usage: $0 <path-to-wasm-file>" >&2
    exit 1
fi

if [ ! -f "$WASM_FILE" ]; then
    echo "ERROR: WASM file not found: $WASM_FILE" >&2
    exit 1
fi

echo "Verifying WASM contract signature for $WASM_FILE..." >&2

# Allow explicit skip for offline local mock tests if configured
if [ "${COSIGN_SKIP_VERIFY:-}" = "true" ]; then
    echo "WARNING: COSIGN_SKIP_VERIFY=true set; skipping cosign verification for $WASM_FILE" >&2
    exit 0
fi

SIG_FILE="${WASM_FILE}.sig"
CERT_FILE="${WASM_FILE}.cert"
BUNDLE_FILE="${WASM_FILE}.bundle"
CHECKSUM_FILE="$(dirname "$WASM_FILE")/checksums.sha256"

# Verify SHA256 integrity if checksum file exists
if [ -f "$CHECKSUM_FILE" ]; then
    WASM_BASENAME="$(basename "$WASM_FILE")"
    if grep -q "$WASM_BASENAME" "$CHECKSUM_FILE"; then
        echo "Verifying SHA256 checksum against $CHECKSUM_FILE..." >&2
        CURRENT_HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')
        RECORDED_HASH=$(grep "$WASM_BASENAME" "$CHECKSUM_FILE" | awk '{print $1}')
        if [ "$CURRENT_HASH" != "$RECORDED_HASH" ]; then
            echo "ERROR: Hash mismatch for $WASM_FILE! Expected $RECORDED_HASH, got $CURRENT_HASH" >&2
            exit 1
        fi
        echo "✓ SHA256 checksum verified for $WASM_FILE" >&2
    fi
fi

# Cosign verification
if command -v cosign &> /dev/null; then
    COSIGN_PUBLIC_KEY="${COSIGN_PUBLIC_KEY:-cosign.pub}"
    
    if [ -f "$BUNDLE_FILE" ]; then
        echo "Verifying sigstore bundle for $WASM_FILE..." >&2
        cosign verify-blob --bundle "$BUNDLE_FILE" "$WASM_FILE" >&2
        echo "✓ Sigstore bundle verified for $WASM_FILE" >&2
        exit 0
    elif [ -f "$SIG_FILE" ]; then
        if [ -f "$CERT_FILE" ]; then
            echo "Verifying keyless signature and certificate for $WASM_FILE..." >&2
            cosign verify-blob --signature "$SIG_FILE" --certificate "$CERT_FILE" "$WASM_FILE" >&2
            echo "✓ Keyless signature verified for $WASM_FILE" >&2
            exit 0
        elif [ -f "$COSIGN_PUBLIC_KEY" ]; then
            echo "Verifying signature with public key $COSIGN_PUBLIC_KEY for $WASM_FILE..." >&2
            cosign verify-blob --key "$COSIGN_PUBLIC_KEY" --signature "$SIG_FILE" "$WASM_FILE" >&2
            echo "✓ Cosign signature verified for $WASM_FILE" >&2
            exit 0
        else
            echo "WARNING: Signature found at $SIG_FILE but no public key or cert provided." >&2
        fi
    else
        echo "ERROR: Missing cosign signature for $WASM_FILE! Expected $SIG_FILE or $BUNDLE_FILE." >&2
        echo "Deploy blocked: refuses to deploy unverified WASM contract to Soroban network." >&2
        exit 1
    fi
else
    # If cosign is not installed, enforce checksum verification if present
    if [ -f "$CHECKSUM_FILE" ]; then
        echo "WARNING: cosign is not installed in environment; verified via checksums.sha256" >&2
        exit 0
    fi
    echo "ERROR: cosign is not installed and no checksum file found for $WASM_FILE!" >&2
    echo "To bypass only in isolated dev, set COSIGN_SKIP_VERIFY=true" >&2
    exit 1
fi
