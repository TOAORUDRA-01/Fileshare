/**
 * WebRTC peer connection management with signaling via WSS.
 * DTLS-SRTP is enforced automatically by all browsers.
 */

import { deriveSharedAESKey, importPeerPublicKey } from '../crypto/ecdh';
import { encryptChunk, decryptChunk } from '../crypto/aes';

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN server (optional — configured at runtime via environment)
];

export type PeerRole = 'sender' | 'receiver';

export interface SignalingMessage {
  type: string;
  sessionId: string;
  [key: string]: unknown;
}

export interface PeerCallbacks {
  onChannelOpen?: (channel: RTCDataChannel) => void;
  onChannelClose?: () => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (err: Error) => void;
}

/**
 * Manages the full WebRTC lifecycle for one session.
 * The signaling server only sees encrypted SDP/ICE blobs.
 */
export class QRBeamPeer {
  private pc: RTCPeerConnection;
  private ws: WebSocket | null = null;
  private aesKey: CryptoKey | null = null;
  private channel: RTCDataChannel | null = null;
  private role: PeerRole;
  private sessionId: string;
  private callbacks: PeerCallbacks;

  constructor(role: PeerRole, sessionId: string, callbacks: PeerCallbacks = {}) {
    this.role = role;
    this.sessionId = sessionId;
    this.callbacks = callbacks;

    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      // Enforce DTLS
      iceTransportPolicy: 'all',
    });

    this.pc.onconnectionstatechange = () => {
      callbacks.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.onicecandidate = async (event) => {
      if (event.candidate && this.ws && this.aesKey) {
        const candidateJson = new TextEncoder().encode(JSON.stringify(event.candidate.toJSON()));
        const { iv, ciphertext } = await encryptChunk(this.aesKey, candidateJson);
        this.wsSend({
          type: 'ICE_CANDIDATE',
          sessionId: this.sessionId,
          iv: Array.from(iv),
          data: Array.from(ciphertext),
        });
      }
    };

    if (role === 'receiver') {
      this.pc.ondatachannel = (event) => {
        this.channel = event.channel;
        this.setupChannel(event.channel);
      };
    }
  }

  /** Connect to the signaling server via WSS and register the session. */
  async connectSignaling(
    signalingUrl: string,
    myPrivateKey: CryptoKey,
    myPublicKeyBytes: Uint8Array,
    peerPublicKeyBytes?: Uint8Array, // provided for sender after receiver joins
    sessionIdBytes?: Uint8Array
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(signalingUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = async () => {
        if (this.role === 'sender') {
          this.wsSend({
            type: 'SENDER_READY',
            sessionId: this.sessionId,
          });
        } else if (this.role === 'receiver' && peerPublicKeyBytes && sessionIdBytes) {
          // Derive AES key now — we have the sender's pub key from QR
          const senderPubKey = await importPeerPublicKey(peerPublicKeyBytes);
          this.aesKey = await deriveSharedAESKey(myPrivateKey, senderPubKey, sessionIdBytes);

          this.wsSend({
            type: 'RECEIVER_JOIN',
            sessionId: this.sessionId,
            receiverPubKey: Array.from(myPublicKeyBytes),
          });
          resolve();
        }
      };

      this.ws.onmessage = async (event) => {
        const msg: SignalingMessage = JSON.parse(
          event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : event.data
        );
        await this.handleSignalingMessage(msg, myPrivateKey, sessionIdBytes);
        if (msg.type === 'NOTIFY_SENDER') resolve();
      };

      this.ws.onerror = () => reject(new Error('WebSocket signaling connection failed'));
      this.ws.onclose = () => {
        // Signaling complete — connection running on P2P
      };
    });
  }

  private async handleSignalingMessage(
    msg: SignalingMessage,
    myPrivateKey: CryptoKey,
    sessionIdBytes?: Uint8Array
  ): Promise<void> {
    if (msg.type === 'NOTIFY_SENDER' && this.role === 'sender') {
      // Receiver joined — derive shared AES key
      const receiverPubKeyBytes = new Uint8Array(msg.receiverPubKey as number[]);
      const receiverPubKey = await importPeerPublicKey(receiverPubKeyBytes);
      const sidBytes = sessionIdBytes ?? new TextEncoder().encode(this.sessionId);
      this.aesKey = await deriveSharedAESKey(myPrivateKey, receiverPubKey, sidBytes);

      // Create DataChannel and initiate offer
      this.channel = this.pc.createDataChannel('qrbeam', { ordered: false });
      this.setupChannel(this.channel);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Encrypt SDP before sending through signaling
      const sdpBytes = new TextEncoder().encode(JSON.stringify(offer));
      const { iv, ciphertext } = await encryptChunk(this.aesKey, sdpBytes);
      this.wsSend({
        type: 'SDP_OFFER',
        sessionId: this.sessionId,
        iv: Array.from(iv),
        data: Array.from(ciphertext),
      });
    }

    else if (msg.type === 'SDP_OFFER' && this.role === 'receiver' && this.aesKey) {
      const iv = new Uint8Array(msg.iv as number[]);
      const data = new Uint8Array(msg.data as number[]);
      const sdpBytes = await decryptChunk(this.aesKey, iv, data);
      const offer = JSON.parse(new TextDecoder().decode(sdpBytes));
      await this.pc.setRemoteDescription(offer);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      const answerBytes = new TextEncoder().encode(JSON.stringify(answer));
      const { iv: aIv, ciphertext: aCt } = await encryptChunk(this.aesKey, answerBytes);
      this.wsSend({
        type: 'SDP_ANSWER',
        sessionId: this.sessionId,
        iv: Array.from(aIv),
        data: Array.from(aCt),
      });
    }

    else if (msg.type === 'SDP_ANSWER' && this.role === 'sender' && this.aesKey) {
      const iv = new Uint8Array(msg.iv as number[]);
      const data = new Uint8Array(msg.data as number[]);
      const sdpBytes = await decryptChunk(this.aesKey, iv, data);
      const answer = JSON.parse(new TextDecoder().decode(sdpBytes));
      await this.pc.setRemoteDescription(answer);
    }

    else if (msg.type === 'ICE_CANDIDATE' && this.aesKey) {
      const iv = new Uint8Array(msg.iv as number[]);
      const data = new Uint8Array(msg.data as number[]);
      const candidateBytes = await decryptChunk(this.aesKey, iv, data);
      const candidate = JSON.parse(new TextDecoder().decode(candidateBytes));
      if (candidate) await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private setupChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => this.callbacks.onChannelOpen?.(channel);
    channel.onclose = () => this.callbacks.onChannelClose?.();
    channel.onerror = (e) => this.callbacks.onError?.(new Error(`DataChannel error: ${e}`));
  }

  getAESKey(): CryptoKey | null { return this.aesKey; }
  getChannel(): RTCDataChannel | null { return this.channel; }

  private wsSend(data: object): void {
    this.ws?.send(JSON.stringify(data));
  }

  close(): void {
    this.ws?.close();
    this.channel?.close();
    this.pc.close();
  }
}
