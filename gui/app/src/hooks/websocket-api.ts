import {
  createContext,
  DependencyList,
  EffectCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  DataFeedMessage,
  DataFeedMessageHeaderT,
  RpcMessage,
  RpcMessageHeaderT,
} from 'solarxr-protocol';
import * as V21 from '@/v21-protocol/all_generated';
import { V21Bridge } from '@/v21/bridge';

import { Builder, ByteBuffer } from 'flatbuffers';
import { useInterval, useTimeout } from './timeout';
import { log } from '@/utils/logging';
import * as Sentry from '@sentry/react';

export interface WebSocketApi {
  isConnected: boolean;
  isFirstConnection: boolean;
  timedOut: boolean;
  reconnect: () => void;
  useRPCPacket: <T>(type: RpcMessage, callback: (packet: T) => void) => void;
  useDataFeedPacket: <T>(type: DataFeedMessage, callback: (packet: T) => void) => void;
  // Runs only while connected and again on every new connection
  useConnectedEffect: (effect: EffectCallback, deps: DependencyList) => void;
  sendRPCPacket: (type: RpcMessage, data: RPCPacketType) => void;
  sendDataFeedPacket: (type: DataFeedMessage, data: DataFeedPacketType) => void;
}

export const WebSocketApiContext = createContext<WebSocketApi>(undefined as never);

export type RPCPacketType = RpcMessageHeaderT['message'];
export type DataFeedPacketType = DataFeedMessageHeaderT['message'];

export function useProvideWebsocketApi(): WebSocketApi {
  const rpcPacketCounterRef = useRef<number>(0);
  const webSocketRef = useRef<WebSocket | null>(null);
  const rpclistenerRef = useRef<EventTarget>(new EventTarget());
  const datafeedlistenerRef = useRef<EventTarget>(new EventTarget());
  const [isFirstConnection, setFirstConnection] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [isConnected, setConnected] = useState(false);

  // VitalVR: the server speaks the v21 protocol, the interface the v22 one
  const bridgeRef = useRef<V21Bridge | null>(null);
  if (!bridgeRef.current) {
    bridgeRef.current = new V21Bridge(
      (bundle) => {
        if (webSocketRef.current?.readyState !== WebSocket.OPEN) return;
        const fbb = new Builder(1);
        fbb.finish(bundle.pack(fbb));
        webSocketRef.current.send(fbb.asUint8Array());
      },
      (kind, type, data) => {
        const target = kind === 'rpc' ? rpclistenerRef : datafeedlistenerRef;
        const name = kind === 'rpc' ? RpcMessage[type] : DataFeedMessage[type];
        target.current?.dispatchEvent(new CustomEvent(name, { detail: data }));
      }
    );
  }

  const urlParams = new URLSearchParams(window.location.search);
  const targetIp = urlParams.get('ip') ?? 'localhost';
  const targetPort = urlParams.get('port') ?? '21110';

  useInterval(() => {
    if (webSocketRef.current && !isConnected) {
      log('Attempting to reconnect');
      reconnect();
    }
  }, 3000);

  const onConnected = () => {
    if (!webSocketRef.current) return;
    Sentry.addBreadcrumb({ category: 'websocket', message: 'Connected to the server' });
    bridgeRef.current?.onConnected();
    setFirstConnection(false);
    setTimedOut(false);
    setConnected(true);
  };

  const onConnectionClose = (event: CloseEvent) => {
    Sentry.addBreadcrumb({
      category: 'websocket',
      level: 'warning',
      message: `Connection to the server closed (code ${event.code})`,
    });
    setConnected(false);
    rpcPacketCounterRef.current = 0;
  };

  const onMessage = async (event: { data: Blob }) => {
    if (!event.data.arrayBuffer) return;
    const buffer = await event.data.arrayBuffer();

    const fbb = new ByteBuffer(new Uint8Array(buffer));

    const message = V21.MessageBundle.getRootAsMessageBundle(fbb).unpack();
    bridgeRef.current?.incoming(message);
  };

  const sendRPCPacket = (type: RpcMessage, data: RPCPacketType): void => {
    if (webSocketRef?.current?.readyState !== WebSocket.OPEN) return;
    bridgeRef.current?.outgoingRpc(type, data);
    Sentry.addBreadcrumb({ category: 'rpc', message: RpcMessage[type] });

    rpcPacketCounterRef.current++;
  };

  const sendDataFeedPacket = (
    type: DataFeedMessage,
    data: DataFeedPacketType
  ): void => {
    if (webSocketRef?.current?.readyState !== WebSocket.OPEN) return;
    bridgeRef.current?.outgoingFeed(type, data);
  };

  const connect = () => {
    webSocketRef.current = new WebSocket(`ws://${targetIp}:${targetPort}`);

    // Connection opened
    webSocketRef.current.addEventListener('open', onConnected);
    webSocketRef.current.addEventListener('close', onConnectionClose);
    webSocketRef.current.addEventListener('message', onMessage);
  };

  const disconnect = () => {
    if (!webSocketRef.current) return;

    webSocketRef.current.removeEventListener('open', onConnected);
    webSocketRef.current.removeEventListener('close', onConnectionClose);
    webSocketRef.current.removeEventListener('message', onMessage);
    webSocketRef.current.close();
    webSocketRef.current = null;
    setConnected(false);
  };

  const reconnect = () => {
    disconnect();
    connect();
  };

  useTimeout(() => {
    if (!isConnected && isFirstConnection) {
      setTimedOut(true);
    }
  }, 10_000); // Show the user that the server timed out if no connection after 10s

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);

  return {
    isConnected,
    isFirstConnection,
    timedOut,
    reconnect,
    useDataFeedPacket: <T>(type: DataFeedMessage, callback: (packet: T) => void) => {
      useEffect(() => {
        const onEvent = (event: CustomEventInit) => {
          callback(event.detail);
        };
        datafeedlistenerRef.current.addEventListener(DataFeedMessage[type], onEvent);
        return () => {
          datafeedlistenerRef.current.removeEventListener(
            DataFeedMessage[type],
            onEvent
          );
        };
      }, [callback, type]);
    },
    useRPCPacket: <T>(type: RpcMessage, callback: (packet: T) => void) => {
      useEffect(() => {
        const onEvent = (event: CustomEventInit) => {
          callback(event.detail);
        };
        rpclistenerRef.current.addEventListener(RpcMessage[type], onEvent);
        return () => {
          rpclistenerRef.current.removeEventListener(RpcMessage[type], onEvent);
        };
      }, [callback, type]);
    },
    useConnectedEffect: (effect: EffectCallback, deps: DependencyList) => {
      useEffect(() => {
        if (!isConnected) return;
        return effect();
      }, [isConnected, ...deps]);
    },
    sendRPCPacket,
    sendDataFeedPacket,
  };
}

export function useWebsocketAPI(): WebSocketApi {
  const context = useContext<WebSocketApi>(WebSocketApiContext);
  if (!context) {
    throw new Error('useWebsocketAPI must be within a WebSocketApi Provider');
  }
  return context;
}
