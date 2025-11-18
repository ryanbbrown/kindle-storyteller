import SwiftUI

struct AudioPlayerCardView: View {
    @ObservedObject var coordinator: PlaybackCoordinator
    let title: String
    let coverImageURL: String?

    @State private var currentTime: TimeInterval = 0
    @State private var timer: Timer?

    private var audioController: AudioPlaybackController {
        coordinator.audioController
    }

    var body: some View {
        GroupBox {
            VStack(spacing: 20) {
                // Cover art
                if let coverImageURL = coverImageURL {
                    AsyncImage(url: URL(string: coverImageURL)) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    } placeholder: {
                        Color.gray.opacity(0.3)
                    }
                    .frame(width: 200, height: 300)
                    .cornerRadius(12)
                    .shadow(radius: 8)
                }

                // Title
                Text(title)
                    .font(.title3.bold())
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                // Progress bar and time labels
                if audioController.isReady, audioController.duration > 0 {
                    VStack(spacing: 8) {
                        let safeProgress = min(max(currentTime, 0), audioController.duration)
                        ProgressView(value: safeProgress, total: audioController.duration)
                            .progressViewStyle(.linear)

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

                // Playback controls
                HStack(spacing: 40) {
                    // Skip backward 10s
                    Button(action: {
                        audioController.skipBackward(seconds: 10)
                    }) {
                        Image(systemName: "gobackward.10")
                            .font(.title2)
                    }
                    .disabled(!audioController.isReady)

                    // Play/Pause
                    Button(action: {
                        if audioController.isPlaying {
                            coordinator.pause()
                        } else {
                            coordinator.play()
                        }
                    }) {
                        Image(systemName: audioController.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 60))
                    }
                    .disabled(!audioController.isReady)

                    // Skip forward 10s
                    Button(action: {
                        audioController.skipForward(seconds: 10)
                    }) {
                        Image(systemName: "goforward.10")
                            .font(.title2)
                    }
                    .disabled(!audioController.isReady)
                }
                .padding(.vertical, 8)

                // Status messages
                if let errorMessage = audioController.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
        }
        .onAppear {
            startTimer()
        }
        .onDisappear {
            stopTimer()
        }
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak audioController] _ in
            guard let audioController = audioController else { return }
            Task { @MainActor in
                currentTime = audioController.currentTime
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
