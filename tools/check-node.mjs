// Node.js の版を確かめる（setup.bat から呼ばれる）
// 古い Node.js でも動くように、ふつうのJavaScriptで書いている。

const REQUIRED = [22, 18, 0];
const current = process.versions.node.split('.').map(Number);

function older(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

if (older(current, REQUIRED)) {
  console.error('');
  console.error(`Node.js の版が古いです（今：${process.versions.node}、必要：${REQUIRED.join('.')} 以上）。`);
  console.error('https://nodejs.org/ から「LTS」の版をインストールし直してから、setup.bat をもう一度実行してください。');
  console.error('');
  process.exit(1);
}
console.log(`Node.js ${process.versions.node}：OK`);
