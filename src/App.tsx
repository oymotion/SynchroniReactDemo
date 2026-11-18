import { useEffect, useState } from 'react';
import { SensorController } from './demo/sidecarSdk';
import BioScreen from './screens/BioScreen';
import DeviceScreen from './screens/DeviceScreen';
import WaveformScreen from './screens/WaveformScreen';
import { DemoController } from './demo/DemoController';

const TABS = [
  { key: 'devices', label: 'Devices' },
  { key: 'waveforms', label: 'IMU' },
  { key: 'bio', label: 'Bio' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('devices');

  useEffect(() => {
    const controller = DemoController.Instance;
    controller.activate();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && SensorController.Instance.connected) {
        void SensorController.Instance.onSuspend().catch(() => false);
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void controller.connectSidecar();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      controller.release();
    };
  }, []);

  return (
    <main className="app-shell">
      <div className="app-body">
        <div className={tab === 'devices' ? 'tab-page' : 'tab-page hidden'}>
          <DeviceScreen visible={tab === 'devices'} />
        </div>
        <div className={tab === 'waveforms' ? 'tab-page' : 'tab-page hidden'}>
          <WaveformScreen visible={tab === 'waveforms'} />
        </div>
        <div className={tab === 'bio' ? 'tab-page' : 'tab-page hidden'}>
          <BioScreen visible={tab === 'bio'} />
        </div>
      </div>
      <nav className="tab-bar" aria-label="Demo pages">
        {TABS.map((item) => (
          <button type="button" key={item.key} className={tab === item.key ? 'active' : ''}
            aria-current={tab === item.key ? 'page' : undefined}
            onClick={() => setTab(item.key)}>{item.label}</button>
        ))}
      </nav>
    </main>
  );
}
