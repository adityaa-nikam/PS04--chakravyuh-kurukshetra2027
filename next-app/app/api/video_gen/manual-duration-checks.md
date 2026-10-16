# Manual duration policy checks

Run from `next-app/`. These use saved/synthetic JSON only, no Ollama calls.

## Tests and bridge metadata

```sh
npm run test:storyboard
npm run --silent storyboard -- /tmp/bridge-script.json --inspect > /tmp/bridge-inspect.json
node -e 'const x=require("/tmp/bridge-inspect.json"); console.log(JSON.stringify({durationPolicy:x.storyboard.durationPolicy,warnings:x.storyboard.warnings},null,2))'
```

Expected bridge: target 45, estimate 79.384, overrun 34.384 seconds / 76.409%,
tolerance 9 seconds, revision threshold 15.75 seconds, `requires_revision`.

## Synthetic cases

```sh
node <<'JS'
const fs = require('node:fs');
for (const [name, words] of [['within',100],['soft',125],['revision',172]]) {
  const scenes = [0,1,2].map(i => ({
    narration: Array(Math.floor(words/3)+(i<words%3?1:0)).fill('word').join(' '),
    visualDirection: 'Show plain text.'
  }));
  fs.writeFileSync(`/tmp/duration-${name}.json`, JSON.stringify({
    title:'Duration policy check', targetAudience:'Beginners',
    estimatedDurationSeconds:45, scenes
  }));
}
JS
for name in within soft revision; do
  npm run --silent storyboard -- "/tmp/duration-$name.json" --inspect > "/tmp/duration-$name-inspect.json"
done
```

## Narration and classification assertions

Whitespace collapse is the existing normalization contract. These saved/synthetic
inputs already use single spaces, so the assertions also check exact string equality.
For other inputs, words/punctuation must match after that whitespace normalization.

```sh
node <<'JS'
const fs=require('node:fs'), assert=require('node:assert/strict');
for(const [input,output,expected] of [
 ['/tmp/bridge-script.json','/tmp/bridge-inspect.json','requires_revision'],
 ...[['within','within_target'],['soft','soft_overrun'],['revision','requires_revision']]
   .map(([n,c])=>[`/tmp/duration-${n}.json`,`/tmp/duration-${n}-inspect.json`,c])
]) {
 const s=JSON.parse(fs.readFileSync(input));
 const {normalized:n,storyboard:b}=JSON.parse(fs.readFileSync(output));
 const narration=s.scenes.map(x=>x.narration);
 assert.deepEqual(n.scenes.map(x=>x.narration),narration);
 assert.deepEqual(b.scenes.map(x=>x.narration),narration);
 assert.equal(b.durationPolicy.classification,expected);
 console.log(input, JSON.stringify(b.durationPolicy), JSON.stringify(b.warnings));
}
JS
```

## Repeatability and custom configuration

```sh
npm run --silent storyboard -- /tmp/bridge-script.json > /tmp/bridge-board-1.json
npm run --silent storyboard -- /tmp/bridge-script.json > /tmp/bridge-board-2.json
diff -u /tmp/bridge-board-1.json /tmp/bridge-board-2.json
printf '%s\n' '{"toleranceSeconds":10}' > /tmp/duration-policy.json
npm run --silent storyboard -- /tmp/bridge-script.json --policy /tmp/duration-policy.json --inspect > /tmp/bridge-custom.json
```

`diff` should produce no output and exit 0. Invalid configuration should exit
nonzero (for example `{"wordsPerMinute":0}`); it must not silently use defaults.
A `requires_revision` result is valid storyboard data, not authorization to render.
