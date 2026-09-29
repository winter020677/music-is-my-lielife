// 読み上げ用オーバーレイの動き
// 本体から「speech」の知らせが来たら、その音声を鳴らす。
// 鳴らし終わったら本体に「ended」を返す（本体は、それを待ってから次の読み上げを送る）。

(function () {
  const debug = new URLSearchParams(location.search).has('debug');
  const debugBox = document.getElementById('debug');
  const unlockButton = document.getElementById('unlock');
  let audio = null;
  let currentId = null;

  const overlay = connectOverlay('speech', {
    onMessage: function (message) {
      if (message.type === 'speech') play(message);
      if (message.type === 'stop' && message.id === currentId) stop();
    },
  });

  function finished(id) {
    if (id !== currentId) return;
    currentId = null;
    if (debug) debugBox.hidden = true;
    overlay.send({ type: 'ended', id: id });
  }

  function play(message) {
    stop();
    currentId = message.id;
    if (debug) {
      debugBox.textContent = message.text || '';
      debugBox.hidden = false;
    }
    audio = new Audio(message.url);
    audio.addEventListener('ended', function () {
      finished(message.id);
    });
    audio.addEventListener('error', function () {
      finished(message.id);
    });
    audio.play().catch(function () {
      // ふつうのブラウザでは、ページを1回クリックするまで音を出せない（OBSの中なら大丈夫）
      if (!isInObs()) unlockButton.hidden = false;
      finished(message.id);
    });
  }

  function stop() {
    if (audio) {
      audio.pause();
      audio = null;
    }
    if (currentId) finished(currentId);
  }

  unlockButton.addEventListener('click', function () {
    unlockButton.hidden = true;
  });
})();
