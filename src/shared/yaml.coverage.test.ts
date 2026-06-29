/** Coverage tests for shared/yaml: uncovered lines 119-120 (block scalar literal join with newline) */
import { describe, expect, it } from 'vitest';
import { parseYamlFrontmatter } from './yaml.js';

describe('yaml coverage', () => {
  describe('block scalar — literal style (lines 119-120)', () => {
    it('joins literal block scalar lines with newline', () => {
      const content = `---
description: |
  Line one
  Line two
  Line three
---
Body content`;

      const result = parseYamlFrontmatter(content);
      expect(result.frontmatter.description).toBe('Line one\nLine two\nLine three');
    });

    it('joins folded block scalar lines with space', () => {
      const content = `---
description: >
  Folded line one
  Folded line two
---
Body content`;

      const result = parseYamlFrontmatter(content);
      expect(result.frontmatter.description).toBe('Folded line one Folded line two');
    });

    it('handles block scalar with strip chomp indicator', () => {
      const content = `---
description: |-
  Stripped line one
  Stripped line two
---
Body content`;

      const result = parseYamlFrontmatter(content);
      expect(result.frontmatter.description).toBe('Stripped line one\nStripped line two');
    });
  });
});
