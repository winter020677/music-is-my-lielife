// ひな形のオーバーレイの動き
// コピーして使う時は、下の 'template' をフォルダの名前に変える。

(function () {
  const box = document.getElementById('box');

  connectOverlay('template', {
    // つながった時と、管理画面で設定を変えた時に呼ばれる
    onSettings: function (settings) {
      // 例：settings.fontSize があれば文字の大きさに使う
    },
    // 本体からの知らせ（アラートなど）が来た時に呼ばれる
    onMessage: function (message) {
      // 例：本体が { type: 'template', text: 'こんにちは' } を送ってきたら表示する
      if (message.type === 'template') {
        // 文字は textContent で入れる（HTMLとして読ませない。安全のため）
        box.textContent = message.text || '';
      }
    },
  });
})();
