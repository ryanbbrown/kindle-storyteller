import SwiftUI

struct PlayerScreen: View {
    @ObservedObject var coordinator: PlaybackCoordinator
    var bookDetails: BookDetails?

    @State private var currentTime: TimeInterval = 0
    @State private var timer: Timer?
    @State private var isSeeking = false

    private var audioController: AudioPlaybackController {
        coordinator.audioController
    }

    private var hasAudio: Bool {
        coordinator.currentTitle != nil
    }

    var body: some View {
        if hasAudio {
            playerContent
        } else {
            emptyState
        }
    }

    private var emptyState: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "waveform")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)

            Text("No audio loaded")
                .font(.title2.bold())

            Text("Generate an audiobook from the Generate tab, or select one from your Library")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var playerContent: some View {
        VStack(spacing: 0) {
            Spacer()

            coverArt
                .padding(.bottom, 24)

            Text(coordinator.currentTitle ?? "Kindle Audio Preview")
                .font(.title2.bold())
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)

            if audioController.isReady, audioController.duration > 0 {
                progressSection
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
            }

            playbackControls
                .padding(.bottom, 32)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { startTimer() }
        .onDisappear { stopTimer() }
    }

    private var coverArt: some View {
        Group {
            if let coverURL = coordinator.currentCoverImageURL {
                AsyncImage(url: URL(string: coverURL)) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } placeholder: {
                    Color.gray.opacity(0.3)
                }
            } else {
                Image("GenericBook")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            }
        }
        .frame(width: 240, height: 360)
        .cornerRadius(16)
        .shadow(radius: 12)
    }

    private var progressSection: some View {
        VStack(spacing: 8) {
            Slider(
                value: $currentTime,
                in: 0...audioController.duration,
                onEditingChanged: { editing in
                    isSeeking = editing
                    if !editing {
                        audioController.seekTo(currentTime)
                    }
                }
            )
            .tint(.accentColor)

            HStack {
                Text(formatTime(currentTime))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Text(formatTime(audioController.duration))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var playbackControls: some View {
        HStack(spacing: 48) {
            Button(action: { audioController.skipBackward(seconds: 10) }) {
                Image(systemName: "gobackward.10")
                    .font(.title)
            }
            .disabled(!audioController.isReady)

            Button(action: {
                if audioController.isPlaying {
                    coordinator.pause()
                } else {
                    coordinator.play()
                }
            }) {
                Image(systemName: audioController.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 72))
            }
            .disabled(!audioController.isReady)

            Button(action: { audioController.skipForward(seconds: 10) }) {
                Image(systemName: "goforward.10")
                    .font(.title)
            }
            .disabled(!audioController.isReady)
        }
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            Task { @MainActor in
                if !isSeeking {
                    currentTime = audioController.currentTime
                }
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func formatTime(_ time: TimeInterval) -> String {
        guard time.isFinite else { return "--:--" }
        let totalSeconds = Int(time.rounded())
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
