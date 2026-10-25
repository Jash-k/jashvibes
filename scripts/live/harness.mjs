/**
 * Shared harness for the split live contract suites. Semantics are identical
 * to the old megatest's inline check(): a throw fails the process, every
 * passing contract prints one PASS line.
 */
export function makeHarness(suite) {
  let passed = 0;
  const check = (label, fn) => { fn(); passed += 1; console.log('  PASS', label); };
  const finish = () => console.log(`\n${passed} passed, 0 failed — ${suite} OK.`);
  return { check, finish };
}
