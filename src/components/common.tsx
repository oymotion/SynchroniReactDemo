import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { DemoController } from '../demo/DemoController';

export function useDemoVersion(visible = true): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!visible) return;
    setVersion((value) => value + 1);
    return DemoController.Instance.subscribe(() => setVersion((value) => value + 1));
  }, [visible]);
  return version;
}

export function DemoPlot({ visible, children }: { visible: boolean; children: () => ReactNode }) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!visible) return;
    setVersion((value) => value + 1);
    return DemoController.Instance.subscribePlot(() => setVersion((value) => value + 1));
  }, [visible]);
  return children();
}

export function DemoStats({ visible, children }: { visible: boolean; children: () => ReactNode }) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!visible) return;
    setVersion((value) => value + 1);
    return DemoController.Instance.subscribeStats(() => setVersion((value) => value + 1));
  }, [visible]);
  return children();
}

export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = Math.max(0, Math.floor(element.clientWidth));
      setWidth((current) => current === next ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const timer = window.setInterval(update, 200);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, []);
  return [ref, width];
}

export function DemoButton({
  title,
  onPress,
  disabled,
  className = '',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return <button type="button" className={`demo-button ${className}`} disabled={disabled} onClick={onPress}>{title}</button>;
}

export function Checkbox({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`checkbox ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
