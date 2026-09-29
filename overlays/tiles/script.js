// イベント一覧の動き
//
// 本体から届く設定（tiles）をもとに、タイルを並べるだけ。
// ルールを変えて保存すると、本体が新しい一覧を送ってくるので、その場で並べ直す（要件 O-4）。

(function () {
  const grid = document.getElementById('grid');
  const template = document.getElementById('tile-template');

  function setImage(img, url) {
    if (url) {
      img.src = url;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
  }

  /** ギフトの絵とコイン数を並べる */
  function fillGifts(box, gifts) {
    box.textContent = '';
    if (!gifts || gifts.length === 0) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    // 多すぎると読めないので、先頭のいくつかだけ出す
    gifts.slice(0, 4).forEach(function (gift) {
      const item = document.createElement('div');
      item.className = 'tile-gift';

      if (gift.image) {
        const img = document.createElement('img');
        img.src = gift.image;
        img.alt = '';
        item.appendChild(img);
      }
      const coins = document.createElement('span');
      coins.textContent = gift.coins > 0 ? String(gift.coins) : gift.name;
      item.appendChild(coins);

      box.appendChild(item);
    });
    if (gifts.length > 4) {
      const more = document.createElement('div');
      more.className = 'tile-gift tile-gift-more';
      more.textContent = '+' + (gifts.length - 4);
      box.appendChild(more);
    }
  }

  function render(tiles) {
    grid.textContent = '';
    if (!tiles || tiles.length === 0) return;

    tiles.forEach(function (tile) {
      const el = template.content.firstElementChild.cloneNode(true);
      // タイルごとの背景色（決めていなければ style.css のまま）
      if (tile.color) el.style.background = tile.color;

      fillGifts(el.querySelector('.tile-gifts'), tile.gifts);
      setImage(el.querySelector('.tile-image'), tile.image);

      // 文字は textContent で入れる（ルール名にHTMLが書かれていても、ただの文字として出る）
      el.querySelector('.tile-name').textContent = tile.name;

      const trigger = el.querySelector('.tile-trigger');
      trigger.textContent = tile.minCoins ? tile.minCoins + 'コイン以上' : tile.triggerLabel;

      const repeat = el.querySelector('.tile-repeat');
      if (tile.repeat) {
        repeat.textContent = '×' + tile.repeat;
        repeat.hidden = false;
      }

      grid.appendChild(el);
    });
  }

  connectOverlay('tiles', {
    onSettings: function (settings) {
      render(settings.tiles);
    },
  });
})();
