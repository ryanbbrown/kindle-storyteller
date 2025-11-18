import AVFoundation
import MediaPlayer
import UIKit

enum PlaybackState {
    case idle
    case loading
    case ready
    case playing
    case paused
    case error(String)
}

@MainActor
final class AudioPlaybackController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published private(set) var isReady = false
    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var playbackState: PlaybackState = .idle

    private var player: AVAudioPlayer?
    private var nowPlayingTitle: String?
    private var nowPlayingArtwork: MPMediaItemArtwork?
    private let commandCenter = MPRemoteCommandCenter.shared()

    var currentTime: TimeInterval {
        player?.currentTime ?? 0
    }

    var duration: TimeInterval {
        player?.duration ?? 0
    }

    func load(url: URL, title: String = "Kindle Audio Preview", coverImageURL: String? = nil) {
        reset()
        playbackState = .loading

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true, options: [])

            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            player?.prepareToPlay()
            nowPlayingTitle = title

            // Enable remote control events
            UIApplication.shared.beginReceivingRemoteControlEvents()

            // Load artwork if cover image URL provided
            if let coverImageURL = coverImageURL {
                Task {
                    await loadArtwork(from: coverImageURL)
                }
            }

            isReady = true
            errorMessage = nil
            playbackState = .ready
            updateNowPlayingInfo(playbackRate: 0)
            configureRemoteCommands()
        } catch {
            errorMessage = "Audio setup failed: \(error.localizedDescription)"
            playbackState = .error(error.localizedDescription)
        }
    }

    private func loadArtwork(from urlString: String) async {
        guard let url = URL(string: urlString) else { return }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let image = UIImage(data: data) else { return }

            nowPlayingArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            updateNowPlayingInfo(playbackRate: isPlaying ? 1 : 0)
        } catch {
            // Silently fail artwork loading - not critical
            print("Failed to load artwork: \(error)")
        }
    }

    func play() {
        guard isReady else {
            errorMessage = "Audio preview not loaded yet."
            return
        }

        guard let player = player else {
            errorMessage = "Audio player not initialized."
            return
        }

        player.play()
        isPlaying = true
        playbackState = .playing
        updateNowPlayingInfo(playbackRate: 1)
    }

    func pause() {
        player?.pause()
        isPlaying = false
        playbackState = .paused
        updateNowPlayingInfo(playbackRate: 0)
    }

    func skipForward(seconds: TimeInterval = 10) {
        guard let player = player else { return }
        let newTime = min(player.currentTime + seconds, player.duration)
        player.currentTime = newTime
        updateNowPlayingInfo(playbackRate: isPlaying ? 1 : 0)
    }

    func skipBackward(seconds: TimeInterval = 10) {
        guard let player = player else { return }
        let newTime = max(player.currentTime - seconds, 0)
        player.currentTime = newTime
        updateNowPlayingInfo(playbackRate: isPlaying ? 1 : 0)
    }

    func reset() {
        player?.stop()
        player = nil
        isReady = false
        isPlaying = false
        errorMessage = nil
        playbackState = .idle
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        nowPlayingTitle = nil
        nowPlayingArtwork = nil
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

        // Skip forward/backward commands
        commandCenter.skipForwardCommand.isEnabled = true
        commandCenter.skipForwardCommand.preferredIntervals = [10]
        commandCenter.skipForwardCommand.addTarget { [weak self] _ in
            self?.skipForward(seconds: 10)
            return .success
        }

        commandCenter.skipBackwardCommand.isEnabled = true
        commandCenter.skipBackwardCommand.preferredIntervals = [10]
        commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
            self?.skipBackward(seconds: 10)
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
        commandCenter.skipForwardCommand.removeTarget(nil)
        commandCenter.skipBackwardCommand.removeTarget(nil)
        if #available(iOS 9.1, *) {
            commandCenter.changePlaybackPositionCommand.removeTarget(nil)
        }
    }

    private func updateNowPlayingInfo(playbackRate: Double) {
        guard let player, let title = nowPlayingTitle else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime,
            MPMediaItemPropertyPlaybackDuration: player.duration,
            MPNowPlayingInfoPropertyPlaybackRate: playbackRate
        ]

        if let artwork = nowPlayingArtwork {
            info[MPMediaItemPropertyArtwork] = artwork
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            isPlaying = false
            playbackState = .ready
            updateNowPlayingInfo(playbackRate: 0)
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            let message = error?.localizedDescription ?? "Audio decode error"
            errorMessage = message
            playbackState = .error(message)
            isPlaying = false
            isReady = false
        }
    }
}
