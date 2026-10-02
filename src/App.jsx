import React, { useState, useEffect } from 'react';

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('catalog');
  const [selectedItem, setSelectedItem] = useState(null);
  const [userPhotoUrl, setUserPhotoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultImage, setResultImage] = useState(null);
  const [showViralModal, setShowViralModal] = useState(false);

  const ITEMS = [
    { id: '1', name: 'Розовое худи Coquette', price: '2 490 ₽', url: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27', wb: '12345678' },
    { id: '2', name: 'Топ корсетный бежевый', price: '1 290 ₽', url: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c', wb: '87654321' }
  ];

  const BACKEND_URL = "УКАЖИТЕ_ССЫЛКУ_НА_RENDER"; // Ссылка с Render без слеша на конце

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.expand();
      const initData = tg.initData;
      const startParam = tg.initDataUnsafe?.start_param;

      fetch(`${BACKEND_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, refCode: startParam })
      })
      .then(res => res.json())
      .then(data => { if (data.success) setUser(data.user); });
    }
  }, []);

  const handleBuy = async (productType) => {
    const tg = window.Telegram.WebApp;
    const res = await fetch(`${BACKEND_URL}/api/create-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tgId: user.tg_id, productType })
    });
    const data = await res.json();
    if (data.invoiceLink) {
      tg.openInvoice(data.invoiceLink, (status) => {
        if (status === 'paid') window.location.reload();
      });
    }
  };

  const handleShare = () => {
    const botName = "ВАШ_БОТ_БЕЗ_СОБАЧКИ"; // Например: GirlsFindsBot
    const refLink = `https://t.me/${botName}/app?startapp=ref_${user.tg_id}`;
    const text = "Смотри, какой крутой мини-апп с примеркой одежды! Заходи по моей ссылке ✨:";
    window.Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`);
  };

  const runTryOn = async () => {
    if (!userPhotoUrl || !selectedItem) return;
    setLoading(true);
    setActiveTab('loading');

    try {
      const res = await fetch(`${BACKEND_URL}/api/tryon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: window.Telegram.WebApp.initData,
          humanImg: userPhotoUrl,
          garmentUrl: selectedItem.url,
          itemId: selectedItem.id
        })
      });
      const data = await res.json();
      if (data.success) {
        setResultImage(data.resultUrl);
        setLoading(false);
        setActiveTab('result');
        // 30% шанс показать поп-ап после успешной примерки
        if (Math.random() < 0.3) setShowViralModal(true);
      } else {
        alert("Не удалось сделать примерку: " + data.error);
        setActiveTab('catalog');
      }
    } catch (e) {
      alert("Ошибка соединения с сервером");
      setActiveTab('catalog');
    }
  };

  if (!user) return <div className="p-6 text-center text-gray-500">Загрузка мини-приложения...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 pb-20">
      {/* Профиль с аватаркой */}
      <div className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm mb-4">
        <div className="flex items-center gap-3">
          <img src={user.photo_url || "https://via.placeholder.com/150"} alt="avatar" className="w-12 h-12 rounded-full object-cover border-2 border-pink-500" />
          <div>
            <h2 className="font-bold text-sm">{user.first_name}</h2>
            <span className="text-xs text-gray-400">@{user.username || 'user'}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold bg-pink-100 text-pink-600 px-2.5 py-1 rounded-full">
            🎁 Попытки: {user.balance}
          </div>
          <div className="text-xs font-semibold bg-amber-100 text-amber-600 mt-1 px-2.5 py-1 rounded-full cursor-pointer" onClick={() => handleBuy('pack10')}>
            ⭐ Купить пакет
          </div>
        </div>
      </div>

      {activeTab === 'catalog' && (
        <div>
          <h3 className="font-bold text-lg mb-3">Выбери образ для примерки</h3>
          <div className="grid grid-cols-2 gap-3">
            {ITEMS.map(item => (
              <div key={item.id} className="bg-white p-3 rounded-xl shadow-sm">
                <img src={item.url} alt="" className="w-full h-40 object-cover rounded-lg mb-2" />
                <h4 className="text-sm font-medium truncate">{item.name}</h4>
                <p className="text-xs text-gray-400 mb-2">{item.price}</p>
                <button onClick={() => { setSelectedItem(item); setActiveTab('upload'); }} className="w-full bg-pink-500 text-white text-xs py-2 rounded-lg font-medium">
                  Примерить ✨
                </button>
              </div>
            ))}
          </div>
          <button onClick={handleShare} className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold">
            👥 Пригласить подругу (+3 попытки)
          </button>
        </div>
      )}

      {activeTab === 'upload' && (
        <div className="text-center p-6 bg-white rounded-2xl">
          <h3 className="font-bold mb-2">Введите прямую ссылку на ваше фото в полный рост</h3>
          <p className="text-xs text-gray-400 mb-4">Например, загрузите фото в Telegram-чат (например, в сохраненные) и скопируйте ссылку на файл.</p>
          <input 
            type="text" 
            placeholder="https://..." 
            value={userPhotoUrl} 
            onChange={(e) => setUserPhotoUrl(e.target.value)} 
            className="w-full p-2 border rounded-xl text-xs mb-4"
          />
          <button onClick={runTryOn} disabled={!userPhotoUrl} className="w-full bg-pink-500 text-white py-3 rounded-xl font-medium disabled:opacity-50">
            Запустить примерку 🪄
          </button>
        </div>
      )}

      {activeTab === 'loading' && (
        <div className="text-center py-20">
          <div className="animate-spin w-10 h-10 border-4 border-pink-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-sm font-medium">Нейросеть примеряет наряд (около 15 секунд)...</p>
        </div>
      )}

      {activeTab === 'result' && (
        <div className="text-center">
          <img src={resultImage} alt="result" className="w-full h-80 object-cover rounded-2xl mb-4 shadow-md" />
          <a href={`https://www.wildberries.ru/catalog/${selectedItem?.wb}/detail.aspx`} target="_blank" rel="noreferrer" className="block w-full bg-purple-600 text-white py-3 rounded-xl font-semibold mb-2">
            🛒 Заказать на Wildberries
          </a>
          <button onClick={() => setActiveTab('catalog')} className="w-full bg-gray-200 py-3 rounded-xl text-sm">
            Вернуться в каталог
          </button>
        </div>
      )}

      {showViralModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl max-w-xs text-center">
            <h3 className="font-bold text-lg mb-2">✨ Понравилось?</h3>
            <p className="text-xs text-gray-500 mb-4">Поделись мини-аппом с подругой — как только она примерит наряд, вы обе получите бонус!</p>
            <button onClick={() => { setShowViralModal(false); handleShare(); }} className="w-full bg-pink-500 text-white py.2.5 rounded-xl text-xs font-semibold mb-2">
              Поделиться с подругой
            </button>
            <button onClick={() => setShowViralModal(false)} className="text-xs text-gray-400">Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
