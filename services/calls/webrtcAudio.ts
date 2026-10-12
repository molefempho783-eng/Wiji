import type { RTCIceCandidateLike, RTCSessionDescriptionLike } from "../../utils/callService";

const webrtc = require("react-native-webrtc");
const RTCPeerConnectionImpl = webrtc.RTCPeerConnection as any;
const RTCIceCandidateImpl = webrtc.RTCIceCandidate as any;
const RTCSessionDescriptionImpl = webrtc.RTCSessionDescription as any;
const mediaDevicesImpl = webrtc.mediaDevices as any;

type ConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

type WebRTCAudioOptions = {
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  onLocalIceCandidate?: (candidate: RTCIceCandidateLike) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
};

const DEFAULT_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302"] }];

export class WebRTCAudioSession {
  private pc: any;
  private localStream: any | null = null;

  constructor(private readonly options: WebRTCAudioOptions = {}) {
    this.pc = new RTCPeerConnectionImpl({
      iceServers: options.iceServers?.length ? options.iceServers : DEFAULT_ICE_SERVERS,
    });

    this.pc.onicecandidate = (event: any) => {
      if (!event.candidate || !this.options.onLocalIceCandidate) return;
      this.options.onLocalIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
      });
    };

    this.pc.onconnectionstatechange = () => {
      const state = (this.pc.connectionState || "new") as ConnectionState;
      this.options.onConnectionStateChange?.(state);
    };
  }

  async prepareLocalAudio() {
    if (this.localStream) return;
    this.localStream = await mediaDevicesImpl.getUserMedia({
      audio: true,
      video: false,
    });
    this.localStream.getTracks().forEach((track: any) => {
      this.pc.addTrack(track, this.localStream as MediaStream);
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionLike> {
    await this.prepareLocalAudio();
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.pc.setLocalDescription(offer);
    return {
      type: "offer",
      sdp: offer.sdp || "",
    };
  }

  async applyOfferAndCreateAnswer(
    offer: RTCSessionDescriptionLike
  ): Promise<RTCSessionDescriptionLike> {
    await this.prepareLocalAudio();
    await this.pc.setRemoteDescription(new RTCSessionDescriptionImpl(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return {
      type: "answer",
      sdp: answer.sdp || "",
    };
  }

  async applyAnswer(answer: RTCSessionDescriptionLike) {
    await this.pc.setRemoteDescription(new RTCSessionDescriptionImpl(answer));
  }

  async addRemoteCandidate(candidate: RTCIceCandidateLike) {
    await this.pc.addIceCandidate(new RTCIceCandidateImpl(candidate));
  }

  mute(muted: boolean) {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = !muted;
    });
  }

  dispose() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => track.stop());
      this.localStream = null;
    }
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
