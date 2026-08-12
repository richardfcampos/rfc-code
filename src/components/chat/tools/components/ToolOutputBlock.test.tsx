import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ToolOutputBlock } from './ToolOutputBlock';

test('output truncates behind a "more lines" footer', () => {
  const text = Array.from({ length: 19 }, (_, index) => `line ${index + 1}`).join('\n');
  const markup = renderToStaticMarkup(<ToolOutputBlock text={text} previewLines={5} />);

  assert.match(markup, /line 5/);
  assert.doesNotMatch(markup, /line 6/);
  assert.match(markup, /14 more lines/);
});

test('a short run has no footer', () => {
  const markup = renderToStaticMarkup(<ToolOutputBlock text={'one\ntwo'} previewLines={5} />);

  assert.doesNotMatch(markup, /more lines/);
});

test('the gutter reuses the line numbers a tool already printed', () => {
  const markup = renderToStaticMarkup(<ToolOutputBlock text={'  12\tconst a = 1;\n  13\tconst b = 2;'} />);

  assert.match(markup, />12</);
  assert.match(markup, />13</);
  assert.doesNotMatch(markup, />1</);
  assert.doesNotMatch(markup, /\t/);
});

test('empty output renders nothing', () => {
  assert.equal(renderToStaticMarkup(<ToolOutputBlock text={'   '} />), '');
});
