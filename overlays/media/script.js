// メディア用オーバーレイの動き
//
// 本体から「media」の知らせが来たら、動画・画像・音を1つ出す。
// ・動画と音は、最後まで再生したら本体に「終わった」と知らせる（本体はそれを待って次に進む）
// ・本体が秒数を決めている時は、その秒数で本体側が次に進むので、ここでは消すだけ
// ・「stop」が来たら、今出しているものを消す（飛ばされた時・打ち切られた時）

(function () {
  const stage = document.getElementById('stage');
  // 今出しているもの（id → 要素）。重ねて出ることはないが、念のため id で持つ
  const showing = new Map();

  function removeItem(id) {
    const el = showing.get(id);
    if (!el) return;
    showing.delete(id);
    // 動画・音は止めてから消す（消すだけだと音が残ることがある）
    const player = el.querySelector('video, audio');
    if (player) {
      try {
        player.pause();
      } catch (e) {
        // 止められなくても消す
      }
    }
    el.remove();
  }

  function removeAll() {
    for (const id of Array.from(showing.keys())) removeItem(id);
  }

  function show(message) {
    // 前のものが残っていたら消す（1つずつ出す）
    removeAll();

    const box = document.createElement('div');
    box.className = 'media-box';
    // 位置は中心で指定する。大きさは画面の幅に対する割合
    box.style.left = message.x + '%';
    box.style.top = message.y + '%';
    box.style.width = message.width + 'vw';

    const volume = Math.max(0, Math.min(1, Number(message.volume)));
    const id = message.id;

    if (message.kind === 'image') {
      const img = document.createElement('img');
      img.src = message.url;
      img.alt = '';
      box.appendChild(img);
    } else if (message.kind === 'video') {
      const video = document.createElement('video');
      video.src = message.url;
      video.autoplay = true;
      video.volume = volume;
      // 音が出ないブラウザ対策ではなく、音を出すのが目的なので muted にはしない
      video.playsInline = true;
      video.addEventListener('ended', function () {
        finish(id);
      });
      // 読み込めなかった時も、本体を待たせ続けない
      video.addEventListener('error', function () {
        finish(id);
      });
      box.appendChild(video);
    } else {
      // 効果音：画面には何も出さない
      box.classList.add('media-audio');
      const audio = document.createElement('audio');
      audio.src = message.url;
      audio.autoplay = true;
      audio.volume = volume;
      audio.addEventListener('ended', function () {
        finish(id);
      });
      audio.addEventListener('error', function () {
        finish(id);
      });
      box.appendChild(audio);
    }

    stage.appendChild(box);
    showing.set(id, box);

    // 本体が秒数を決めている時は、その秒数で消す（本体側も同じ秒数で次に進む）
    if (message.durationMs > 0) {
      setTimeout(function () {
        removeItem(id);
      }, message.durationMs);
    }
  }

  /** 再生が終わったことを本体に知らせて、画面から消す */
  function finish(id) {
    removeItem(id);
    overlay.send({ type: 'ended', id: id });
  }

  const overlay = connectOverlay('media', {
    onMessage: function (message) {
      if (message.type === 'media') show(message);
      if (message.type === 'stop') removeItem(message.id);
    },
  });
})();
