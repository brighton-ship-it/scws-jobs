'use client';

import { useState, useEffect } from 'react';

export default function PushTestPage() {
  const [status, setStatus] = useState<string[]>(['Loading...']);
  const [canSubscribe, setCanSubscribe] = useState(false);

  const log = (msg: string) => {
    setStatus(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    const check = async () => {
      setStatus([]);
      
      // Check basics
      log(`serviceWorker in navigator: ${'serviceWorker' in navigator}`);
      log(`PushManager in window: ${'PushManager' in window}`);
      log(`Notification in window: ${'Notification' in window}`);
      
      if (!('serviceWorker' in navigator)) {
        log('❌ Service Worker not supported');
        return;
      }

      // Check for existing SW
      const regs = await navigator.serviceWorker.getRegistrations();
      log(`Service workers registered: ${regs.length}`);
      
      if (regs.length === 0) {
        log('⏳ Registering service worker...');
        try {
          const reg = await navigator.serviceWorker.register('/sw.js');
          log(`✅ SW registered: ${reg.scope}`);
        } catch (e) {
          log(`❌ SW register failed: ${e}`);
          return;
        }
      }

      // Wait for ready
      log('⏳ Waiting for SW ready...');
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej('timeout'), 5000))
        ]) as ServiceWorkerRegistration;
        log(`✅ SW ready: ${reg.active?.state || 'unknown'}`);
      } catch (e) {
        log(`❌ SW ready failed: ${e}`);
        return;
      }

      // Check notification permission
      log(`Notification.permission: ${Notification.permission}`);
      
      setCanSubscribe(true);
      log('✅ Ready to subscribe!');
    };
    
    check();
  }, []);

  const requestPermission = async () => {
    log('⏳ Requesting permission...');
    try {
      const result = await Notification.requestPermission();
      log(`Permission result: ${result}`);
    } catch (e) {
      log(`❌ Permission error: ${e}`);
    }
  };

  const subscribe = async () => {
    log('⏳ Starting subscription...');
    try {
      const reg = await navigator.serviceWorker.ready;
      log('Got SW registration');
      
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      log(`VAPID key: ${vapidKey ? 'Present' : 'MISSING!'}`);
      
      if (!vapidKey) {
        log('❌ No VAPID key configured');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
      log(`✅ Subscribed! Endpoint: ${sub.endpoint.slice(0, 50)}...`);
      
      // Save to server
      const resp = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      log(`Server response: ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      log(`Server data: ${JSON.stringify(data)}`);
      
    } catch (e) {
      log(`❌ Subscribe error: ${e}`);
    }
  };

  const testNotification = async () => {
    log('⏳ Sending test notification...');
    try {
      const resp = await fetch('/api/push/test', { method: 'POST' });
      const data = await resp.json();
      log(`Test result: ${JSON.stringify(data)}`);
    } catch (e) {
      log(`❌ Test error: ${e}`);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold mb-4">Push Notification Test</h1>
      
      <div className="space-y-2 mb-4">
        <button 
          onClick={requestPermission}
          className="w-full p-3 bg-blue-500 text-white rounded"
        >
          1. Request Permission
        </button>
        <button 
          onClick={subscribe}
          disabled={!canSubscribe}
          className="w-full p-3 bg-green-500 text-white rounded disabled:opacity-50"
        >
          2. Subscribe to Push
        </button>
        <button 
          onClick={testNotification}
          className="w-full p-3 bg-purple-500 text-white rounded"
        >
          3. Send Test Notification
        </button>
      </div>

      <div className="bg-gray-100 p-3 rounded text-sm font-mono overflow-auto max-h-96">
        {status.map((s, i) => (
          <div key={i} className={s.includes('❌') ? 'text-red-600' : s.includes('✅') ? 'text-green-600' : ''}>
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
