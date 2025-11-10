import AVFoundation
import MediaPlayer

@MainActor
final class AudioPlaybackController: ObservableObject {
    @Published private(set) var isReady = false
    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?

    private var player: AVAudioPlayer?
    private var nowPlayingTitle: String?
    private let commandCenter = MPRemoteCommandCenter.shared()

    func load(url: URL, title: String = "Kindle Audio Preview") {
        reset()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)

            player = try AVAudioPlayer(contentsOf: url)
            player?.prepareToPlay()
            nowPlayingTitle = title
            isReady = true
            errorMessage = nil
            updateNowPlayingInfo(playbackRate: 0)
            configureRemoteCommands()
        } catch {
            errorMessage = "Audio setup failed: \(error.localizedDescription)"
        }
    }

    func play() {
        guard isReady else {
            errorMessage = "Audio preview not loaded yet."
            return
        }
        player?.play()
        isPlaying = true
        updateNowPlayingInfo(playbackRate: 1)
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlayingInfo(playbackRate: 0)
    }

    func reset() {
        player?.stop()
        player = nil
        isReady = false
        isPlaying = false
        errorMessage = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        nowPlayingTitle = nil
        removeRemoteCommandTargets()
    }

    private func configureRemoteCommands() {
        removeRemoteCommandTargets()

        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.play()
            return .success
        }

        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }

        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.isPlaying ? self.pause() : self.play()
            return .success
        }

        if #available(iOS 9.1, *) {
            commandCenter.changePlaybackPositionCommand.isEnabled = true
            commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
                guard
                    let self,
                    let ev = event as? MPChangePlaybackPositionCommandEvent,
                    let player = self.player
                else {
                    return .commandFailed
                }
                player.currentTime = ev.positionTime
                self.updateNowPlayingInfo(playbackRate: player.isPlaying ? 1 : 0)
                return .success
            }
        }
    }

    private func removeRemoteCommandTargets() {
        commandCenter.playCommand.removeTarget(nil)
        commandCenter.pauseCommand.removeTarget(nil)
        commandCenter.togglePlayPauseCommand.removeTarget(nil)
        if #available(iOS 9.1, *) {
            commandCenter.changePlaybackPositionCommand.removeTarget(nil)
        }
    }

    private func updateNowPlayingInfo(playbackRate: Double) {
        guard let player, let title = nowPlayingTitle else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime,
            MPMediaItemPropertyPlaybackDuration: player.duration,
            MPNowPlayingInfoPropertyPlaybackRate: playbackRate
        ]
    }
}
