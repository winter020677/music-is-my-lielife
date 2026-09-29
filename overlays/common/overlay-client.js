// オーバーレイ共通の部品：本体とつなぐ
//
// ・本体が再起動しても、自動でつなぎ直す（要件 O-3）
// ・本体から「再読み込み」の合図が来たら、ページを読み直す（要件 O-5）
// ・設定が変わったら、新しい設定を受け取る（要件 O-4）
//
// 使い方（各オーバーレイの script.js から）：
//   const overlay = connectOverlay('alert', {
//     onSettings(settings) { ... },   // つながった時と、設定が変わった時
//     onMessage(message) { ... },     // それ以外の知らせ（アラートなど）
//   });
//   overlay.send({ type: 'ended', id: '...' });  // 本体へ知らせる

(function () {
  // つなぎ直すまでの待ち時間（ミリ秒）。何度も失敗したら、だんだん延ばす
  const RETRY_DELAYS = [1000, 2000, 5000];

  function connectOverlay(name, handlers) {
    let socket = null;
    let failures = 0;

    function open() {
      const url = 'ws://' + location.host + '/ws/overlay?name=' + encodeURIComponent(name);
      socket = new WebSocket(url);

      socket.addEventListener('open', function () {
        failures = 0;
      });

      socket.addEventListener('message', function (event) {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (message.type === 'reload') {
          location.reload();
          return;
        }
        if (message.type === 'hello' || message.type === 'settings') {
          if (handlers.onSettings) handlers.onSettings(message.settings || {});
          return;
        }
        if (handlers.onMessage) handlers.onMessage(message);
      });

      socket.addEventListener('close', function () {
        const delay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length - 1)];
        failures += 1;
        setTimeout(open, delay);
      });

      socket.addEventListener('error', function () {
        socket.close();
      });
    }

    open();

    return {
      send: function (message) {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
  }

  // OBSの中で表示されているか（OBSのブラウザソースには window.obsstudio がある）
  function isInObs() {
    return typeof window.obsstudio !== 'undefined';
  }

  window.connectOverlay = connectOverlay;
  window.isInObs = isInObs;
})();
