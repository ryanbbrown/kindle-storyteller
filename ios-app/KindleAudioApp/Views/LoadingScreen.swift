import SwiftUI

struct LoadingScreen: View {
    var isComplete: Bool
    var useLlmPreprocessing: Bool

    private var statusSteps: [(message: String, duration: TimeInterval)] {
        var steps: [(String, TimeInterval)] = [
            ("Downloading book content...", 2.0),
            ("Processing glyphs...", 2.0),
        ]
        if useLlmPreprocessing {
            steps.append(("Running LLM preprocessing...", 15.0))
        }
        steps.append(("Calling TTS provider...", 4.0))
        steps.append(("Generating audio...", 0)) // Final step, no auto-advance
        return steps
    }

    @State private var currentStepIndex = 0
    @State private var timer: Timer?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()
                .frame(maxHeight: .infinity)

            if isComplete {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.green)
                    .transition(.opacity)
            } else {
                ProgressView()
                    .scaleEffect(2)
            }

            VStack(spacing: 12) {
                if !isComplete {
                    ForEach(0...currentStepIndex, id: \.self) { index in
                        HStack(spacing: 8) {
                            if index < currentStepIndex {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .font(.subheadline)
                            } else {
                                ProgressView()
                                    .scaleEffect(0.7)
                            }
                            Text(statusSteps[index].message)
                                .font(.subheadline)
                                .foregroundStyle(index == currentStepIndex ? .primary : .secondary)
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
            }
            .frame(minHeight: 150, alignment: .top)
            .animation(.easeInOut(duration: 0.3), value: currentStepIndex)

            Spacer()
                .frame(maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut, value: isComplete)
        .onAppear { scheduleNextStep() }
        .onDisappear { stopTimer() }
    }

    private func scheduleNextStep() {
        guard !isComplete, currentStepIndex < statusSteps.count - 1 else { return }
        let duration = statusSteps[currentStepIndex].duration
        guard duration > 0 else { return }

        timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { _ in
            currentStepIndex += 1
            scheduleNextStep()
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
