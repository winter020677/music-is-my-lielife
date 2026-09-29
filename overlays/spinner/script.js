// スピナー用オーバーレイの動き
//
// 本体から「spin」の知らせが来たら、輪を回して、決まった当たりの位置で止める。
//
// 大事なところ：当たりを決めるのは本体です（winnerIndex で届きます）。
// ここは「その位置で止まる」ように回す角度を計算して見せるだけなので、
// 見た目を変えても、当たりやすさ（重み）は変わりません。

(function () {
  const stage = document.getElementById('stage');
  const wheel = document.getElementById('wheel');
  const result = document.getElementById('result');
  const resultImage = document.getElementById('result-image');
  const resultName = document.getElementById('result-name');

  // 回る前に、何周ぶん余分に回すか（勢いを見せるため）
  const EXTRA_TURNS = 5;

  let hideTimer = null;

  /** 項目を輪の形に並べる */
  function buildWheel(items) {
    wheel.textContent = '';
    const step = 360 / items.length;

    items.forEach(function (item, i) {
      const slice = document.createElement('div');
      slice.className = 'slice';
      slice.dataset.rarity = String(item.rarity || 1);
      // 項目を、輪の上に等間隔で置く
      slice.style.transform = 'rotate(' + i * step + 'deg)';

      const face = document.createElement('div');
      face.className = 'slice-face';
      face.style.background = item.color;

      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        face.appendChild(img);
      }
      const name = document.createElement('span');
      // 文字は textContent で入れる（項目名にHTMLが書かれていても、ただの文字として出る）
      name.textContent = item.name;
      face.appendChild(name);

      slice.appendChild(face);
      wheel.appendChild(slice);
    });
  }

  function spin(message) {
    const items = message.items || [];
    if (items.length === 0) return;

    clearTimeout(hideTimer);
    result.hidden = true;
    stage.hidden = false;
    buildWheel(items);

    const step = 360 / items.length;
    // 当たりの項目が、上の針の位置に来るまで回す角度
    const target = EXTRA_TURNS * 360 - message.winnerIndex * step;

    // いったん角度をゼロに戻してから回す（2回目以降も同じ長さ回るように）
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    // ブラウザに今の状態を一度描かせてから、回し始める
    void wheel.offsetWidth;

    const spinMs = message.spinMs || 4000;
    wheel.style.transition = 'transform ' + spinMs + 'ms cubic-bezier(0.17, 0.67, 0.21, 1)';
    wheel.style.transform = 'rotate(' + target + 'deg)';

    // 止まったら、当たりを大きく見せる
    setTimeout(function () {
      const winner = items[message.winnerIndex];
      if (!winner) return;
      resultName.textContent = winner.name;
      result.dataset.rarity = String(winner.rarity || 1);
      if (winner.image) {
        resultImage.src = winner.image;
        resultImage.hidden = false;
      } else {
        resultImage.hidden = true;
      }
      result.hidden = false;
    }, spinMs);

    // 当たりを見せ終わったら、全部消す
    hideTimer = setTimeout(
      function () {
        stage.hidden = true;
      },
      spinMs + (message.resultMs || 3000),
    );
  }

  function stop() {
    clearTimeout(hideTimer);
    stage.hidden = true;
    result.hidden = true;
  }

  connectOverlay('spinner', {
    onMessage: function (message) {
      if (message.type === 'spin') spin(message);
      if (message.type === 'stop') stop();
    },
  });
})();
