#!/usr/bin/env bash
# Every test runs against a real socket and the real keyring. No mocks of
# libsoup or libsecret — those two are exactly where the bugs were.
set -u
cd "$(dirname "$0")"

PORT=${POLIFIX_TEST_PORT:-8791}
python3 fake-provider.py "$PORT" &
FAKE=$!
trap 'kill $FAKE 2>/dev/null' EXIT
sleep 1

status=0
for test in *.test.js; do
    echo "── $test"
    FAKE_PORT=$PORT gjs -m "$test" || status=1
    echo
done

exit $status
