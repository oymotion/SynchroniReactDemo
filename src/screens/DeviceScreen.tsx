import type { BLEDevice, DeviceInfo } from '../demo/sidecarSdk';
import { DeviceStateEx } from '../demo/sidecarSdk';
import { Checkbox, DemoButton, DemoStats, useDemoVersion } from '../components/common';
import {
  DemoController,
  DEMO_VERSION,
  FILTER_OPTIONS,
  NTF_OPTIONS,
  SAMPLE_RATE_CONTROLS,
} from '../demo/DemoController';

function ntfChannelCount(key: string, info: DeviceInfo): number {
  switch (key) {
    case 'NTF_EEG': return info.EegChannelCount;
    case 'NTF_IMPEDANCE': return info.ImpeChannelCount;
    case 'NTF_EMG':
    case 'NTF_GEST': return info.EmgChannelCount;
    case 'NTF_PPG': return info.PpgChannelCount;
    case 'NTF_SPO2': return info.Spo2ChannelCount;
    case 'NTF_IMU': return info.AccChannelCount + info.GyroChannelCount;
    case 'NTF_ANGLE': return info.AngleChannelCount;
    default: return 0;
  }
}

export default function DeviceScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);
  const active = controller.getActiveState();
  const info = active?.info;
  const ready = active?.profile.isReady ?? false;
  const realConnected = controller.hasRealDeviceConnected();
  const selectedState = controller.selectedMac
    ? controller.deviceStates.get(controller.selectedMac) : undefined;
  const selectedReady = selectedState?.profile.isReady ?? false;
  const canDisconnect = selectedState !== undefined
    && selectedState.profile.deviceState !== DeviceStateEx.Disconnected;

  const renderDevice = (device: BLEDevice) => {
    const st = controller.deviceStates.get(device.Address);
    const connected = st?.profile.isReady ?? false;
    const selected = controller.selectedMac === device.Address;
    return (
      <button
        type="button"
        role="option"
        aria-selected={selected}
        data-mac={device.Address}
        data-streaming={st?.streaming ?? false}
        className={`device-row ${selected ? 'selected' : ''}`}
        key={device.Address}
        onClick={() => controller.selectDevice(device.Address)}
      >
        <span>
          {st?.streaming ? '[Streaming] ' : connected ? '[Connected] ' : ''}
          {st?.isReplay ? '[Replay] ' : ''}
          {`RSSI: ${device.RSSI}, Name: ${device.Name}, Address: ${device.Address}`}
        </span>
        {st && <DemoStats visible={visible}>{() => <span className="batch-count">{st.batches} batches</span>}</DemoStats>}
      </button>
    );
  };

  return (
    <div className="screen-scroll device-screen">
      <section className="sidecar-panel">
        <div className="panel-heading">
          <h1>Sensor SDK React Demo</h1>
          <span>v{DEMO_VERSION}</span>
        </div>
        <div className="endpoint-grid">
          <label htmlFor="sidecar-url">WebSocket URL</label>
          <input
            id="sidecar-url"
            value={controller.sidecarUrl}
            disabled={controller.sidecarConnected || controller.sidecarBusy}
            onChange={(event) => { controller.sidecarUrl = event.target.value; controller.notify(); }}
            spellCheck={false}
          />
          <label htmlFor="sidecar-token">Token</label>
          <input
            id="sidecar-token"
            type="password"
            value={controller.sidecarToken}
            disabled={controller.sidecarConnected || controller.sidecarBusy}
            onChange={(event) => { controller.sidecarToken = event.target.value; controller.notify(); }}
          />
          <div className="button-row">
            <DemoButton title="Connect Sidecar" className="primary" onPress={() => void controller.connectSidecar()}
              disabled={controller.sidecarConnected || controller.sidecarBusy} />
            <DemoButton title="Disconnect Sidecar" onPress={() => void controller.disconnectSidecar()}
              disabled={!controller.sidecarConnected || controller.sidecarBusy} />
          </div>
        </div>
      </section>

      <p className="status" role="status">{controller.status}</p>
      <p className="telemetry"><DemoStats visible={visible}>{() => controller.rateText}</DemoStats></p>
      <p className="telemetry">SDK: {controller.sdkVersion || '--'} | Backend: {info?.Backend || '--'}</p>
      <div className="info-grid">
        <span>Model: {info?.ModelName ?? '--'}</span>
        <span>HW Version: {info?.HardwareVersion ?? '--'}</span>
        <span>FW Version: {info?.FirmwareVersion ?? '--'}</span>
        <span>Power: {active?.power !== undefined ? `${active.power}%` : '--%'}</span>
        <span>Link: {info && info.PeripheralLatency >= 0 && info.ConnectionIntervalMs > 0
          ? `${info.ConnectionIntervalMs}ms / latency ${info.PeripheralLatency} / timeout ${info.SupervisionTimeoutMs}ms` : '--'}</span>
        <span>MTU: {info && info.MTUSize > 0 ? info.MTUSize : '--'}</span>
      </div>

      <div className="toggle-grid">
        <Checkbox label="Auto Reconnect" checked={controller.autoReconnect}
          onToggle={(enabled) => { controller.autoReconnect = enabled; }} />
        <Checkbox label="Use Worker DSP" checked={controller.useWorklets} onToggle={controller.setUseWorklets} />
        <Checkbox label="Clone Data (Worker IPC)" checked={controller.cloneData} onToggle={controller.setCloneData} />
      </div>

      <div className="device-list" role="listbox" aria-label="Sensor devices">
        {controller.devices.length > 0 ? controller.devices.map(renderDevice) : <div className="device-row empty">No devices</div>}
      </div>

      <div className="button-row">
        <DemoButton title="Start Scan" onPress={() => void controller.startScanning()}
          disabled={!controller.sidecarConnected || controller.scanning} />
        <DemoButton title="Stop Scan" onPress={() => void controller.stopScanning()} disabled={!controller.scanning} />
        <DemoButton title="Connect" onPress={() => void controller.connectSelected()}
          disabled={!controller.sidecarConnected || !controller.selectedMac || selectedReady} />
        <DemoButton title="Disconnect" onPress={() => void controller.disconnectSelected()} disabled={!canDisconnect} />
        <DemoButton title="Multi Start" onPress={() => void controller.multiStart()} disabled={!controller.sidecarConnected} />
        <DemoButton title="Multi Stop" onPress={() => void controller.multiStop()} disabled={!controller.sidecarConnected} />
      </div>

      <h2>Bin Replay</h2>
      <div className="path-grid">
        <label htmlFor="bin-path">Bin path on the sidecar computer</label>
        <input id="bin-path" value={controller.binPathInput} spellCheck={false}
          placeholder="C:/tmp/capture.bin"
          onChange={(event) => { controller.binPathInput = event.target.value; controller.notify(); }} />
        <label htmlFor="multi-bin-paths">Group paths, separated by semicolons</label>
        <input id="multi-bin-paths" value={controller.multiBinPathsInput} spellCheck={false}
          placeholder="C:/tmp/a.bin;C:/tmp/b.bin"
          onChange={(event) => { controller.multiBinPathsInput = event.target.value; controller.notify(); }} />
      </div>
      <div className="button-row">
        <DemoButton title={'Replay Bin\u2026'} onPress={() => void controller.pickAndReplayBin()}
          disabled={!controller.sidecarConnected || realConnected || controller.replayActive()} />
        <DemoButton title={'Multi Replay Bin\u2026'} onPress={() => void controller.pickAndMultiReplayBins()}
          disabled={!controller.sidecarConnected || realConnected || controller.replayActive()} />
        <DemoButton title={'Analyze Bin\u2026'} onPress={() => void controller.pickAndAnalyzeBin()}
          disabled={!controller.sidecarConnected || realConnected} />
        <DemoButton title={controller.replayPaused ? 'Resume Replay' : 'Pause Replay'}
          onPress={() => void controller.pauseResumeReplay()} disabled={!controller.replayActive()} />
        <DemoButton title="Stop Replay" onPress={() => void controller.stopReplay()} disabled={!controller.replayActive()} />
        {import.meta.env.DEV && (
          <>
            <DemoButton title="DBG Replay Current" onPress={() => void controller.debugReplayLatestBin()}
              disabled={!controller.sidecarConnected || realConnected || controller.replayActive()} />
            <DemoButton title={controller.debugReplayLoop ? '[x] DBG Loop' : '[ ] DBG Loop'}
              onPress={controller.toggleDebugReplayLoop} />
          </>
        )}
      </div>

      <h2>Debug Log</h2>
      <div className="toggle-grid">
        <Checkbox label="Enable SDK Debug Log" checked={controller.debugLogEnabled}
          onToggle={(enabled) => void controller.setDebugLogEnabled(enabled)} />
        <Checkbox label="Enable Debug Bin Data" checked={controller.binDataEnabled}
          onToggle={(enabled) => void controller.setBinDataEnabled(enabled)} />
        <Checkbox label="Enable debug dongle" checked={controller.debugDongleEnabled}
          onToggle={(enabled) => void controller.setDebugDongleEnabled(enabled)} />
        <Checkbox label="Translate IMU (split ACC/GYRO/EULER/QUAT)" checked={controller.translateImu}
          onToggle={(enabled) => void controller.setTranslateImu(enabled)} />
      </div>

      <h2>Data Notification</h2>
      <div className="toggle-grid">
        {NTF_OPTIONS.filter((option) => !info || ntfChannelCount(option.key, info) > 0).map((option) => (
          <Checkbox key={option.key} label={option.label} checked={controller.ntfStates[option.key] ?? false}
            disabled={!ready} onToggle={(enabled) => void controller.setNtfEnabled(option.key, enabled)} />
        ))}
      </div>

      <h2>Filter</h2>
      <div className="toggle-grid">
        {FILTER_OPTIONS.map((option) => (
          <Checkbox key={option.key} label={option.label} checked={controller.filterStates[option.key] ?? false}
            disabled={!ready} onToggle={(enabled) => void controller.setFilterEnabled(option.key, enabled)} />
        ))}
      </div>

      {SAMPLE_RATE_CONTROLS.map((control) => {
        const options = controller.sampleRateOptions[control.key] ?? [];
        const usable = control.candidates.filter((rate) => options.includes(rate));
        if (usable.length === 0) return null;
        return (
          <fieldset className="rate-group" key={control.key}>
            <legend>{control.label}</legend>
            <div className="toggle-grid">
              {usable.map((rate) => (
                <label className="checkbox" key={rate}>
                  <input type="radio" name={control.key} checked={(controller.sampleRateCurrent[control.key] ?? 0) === rate}
                    disabled={!ready} onChange={() => void controller.setSampleRate(control.key, rate)} />
                  <span>{rate}Hz</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      <h2>Packet Loss Stats</h2>
      <p className="telemetry"><DemoStats visible={visible}>{() => controller.lostText}</DemoStats></p>
      <h2>Gesture</h2>
      <DemoStats visible={visible}>{() => {
        const gesture = controller.getActiveState()?.gesture;
        return <div className="gesture-box">
          <span>gesture (0-8): {gesture ? String(gesture.gesture) : '-'}</span>
          <span>raw gesture (0-8): {gesture ? gesture.rawGesture : '-'}</span>
          <span>possiblity (0-100): {gesture ? String(gesture.possibility) : '-'}</span>
          <span>strength (0-100): {gesture ? String(gesture.strength) : '-'}</span>
        </div>;
      }}</DemoStats>
    </div>
  );
}
