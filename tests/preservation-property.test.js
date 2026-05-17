/**
 * Preservation Property Tests - Small/Medium Page Extraction Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * Property 2: Preservation - For any DOM tree below MAX_NODE_COUNT (50,000 nodes),
 * the extraction pipeline produces consistent, deterministic output.
 *
 * EXPECTED OUTCOME: All tests PASS (confirms no regressions after fix)
 *
 * NOTE: Tests are run in a child process to avoid vitest worker memory limits
 * with Node.js v24. The test logic is in run-preservation-direct.mjs.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

describe('Preservation Property Tests: Small/Medium Page Extraction Unchanged', function () {

  /**
   * Property 2.1-2.6: All preservation properties
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
   */
  it('Property 2.1: domToMarkdown produces deterministic output for any small/medium DOM tree', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('Property 2.1: domToMarkdown determinism');
    expect(result).toContain('✓ Property 2.1');
  });

  it('Property 2.2: stripNoise removes all noise elements (STRIP_SELECTORS + inline-hidden)', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('✓ Property 2.2');
  });

  it('Property 2.3: extractCodeBlocks produces deterministic output with correct structure', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('✓ Property 2.3');
  });

  it('Property 2.4: full extraction pipeline produces deterministic payload with correct structure', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('✓ Property 2.4');
  });

  it('Property 2.5: varying nesting depths and element types produce deterministic preserved output', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('✓ Property 2.5');
  });

  it('Property 2.6: GitHub extraction on small pages produces deterministic correct payload', function () {
    const scriptPath = resolve(__dirname, 'run-preservation-direct.mjs');
    const result = execSync(`node "${scriptPath}"`, {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    expect(result).toContain('✓ Property 2.6');
    expect(result).toContain('6 passed, 0 failed');
  });
});
