import { writeFileSync } from 'node:fs';
import { tokensCss } from '../src/ui/tokens';

writeFileSync(new URL('../src/styles/tokens.css', import.meta.url), tokensCss());
console.log('src/styles/tokens.css 已生成');
