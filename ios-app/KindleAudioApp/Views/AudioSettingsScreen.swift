import SwiftUI

struct AudioSettingsScreen: View {
    var bookDetails: BookDetails?
    @Binding var selectedProvider: String
    @Binding var llmPreprocessing: Bool
    @Binding var durationMinutes: Int
    @Binding var useManualPosition: Bool
    @Binding var manualPosition: String
    var onGenerate: () -> Void

    @State private var showInfoPopover = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let details = bookDetails {
                    bookDetailsCard(details)
                } else {
                    noBookSelectedCard
                }

                settingsCard
            }
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.secondarySystemBackground))
    }

    private var noBookSelectedCard: some View {
        VStack(spacing: 16) {
            Image(systemName: "book.closed")
                .font(.system(size: 50))
                .foregroundStyle(.secondary)

            Text("No book selected")
                .font(.headline)

            Text("Go to the Connect tab and select a book from your Kindle library")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 10, y: 4)
        )
    }

    private func bookDetailsCard(_ details: BookDetails) -> some View {
        VStack(spacing: 16) {
            AsyncImage(url: URL(string: details.coverImage)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } placeholder: {
                Image("GenericBook")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            }
            .frame(width: 100, height: 150)
            .cornerRadius(8)
            .shadow(radius: 4)

            Text(details.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(3)

            HStack(spacing: 16) {
                Label(String(format: "%.1f%%", details.progressPercent), systemImage: "book")
                Label(details.currentPositionLabel, systemImage: "bookmark")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 10, y: 4)
        )
    }

    private var settingsCard: some View {
        VStack(spacing: 24) {
            HStack {
                Color.clear.frame(width: 22)
                Spacer()
                Text("Audio Settings")
                    .font(.title2.bold())
                Spacer()
                Button(action: { showInfoPopover = true }) {
                    Image(systemName: "info.circle")
                        .font(.title3)
                        .foregroundColor(.secondary)
                }
                .popover(isPresented: $showInfoPopover) {
                    infoPopoverContent
                }
            }

            providerPicker

            durationSlider

            Toggle("LLM preprocessing", isOn: $llmPreprocessing)

            manualPositionSection

            Button(action: onGenerate) {
                Label("Generate Audiobook", systemImage: "waveform.badge.plus")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(bookDetails == nil ? Color.gray : Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .disabled(bookDetails == nil)

            if bookDetails == nil {
                Text("Select a book to enable generation")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(24)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemBackground))
                .shadow(color: .black.opacity(0.1), radius: 10, y: 4)
        )
    }

    private var providerPicker: some View {
        HStack(spacing: 0) {
            Button(action: { selectedProvider = "elevenlabs" }) {
                Text("ElevenLabs")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(selectedProvider == "elevenlabs" ? Color.accentColor : Color.gray.opacity(0.2))
                    .foregroundColor(selectedProvider == "elevenlabs" ? .white : .primary)
            }

            Button(action: { selectedProvider = "cartesia" }) {
                Text("Cartesia")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(selectedProvider == "cartesia" ? Color.accentColor : Color.gray.opacity(0.2))
                    .foregroundColor(selectedProvider == "cartesia" ? .white : .primary)
            }
        }
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.gray.opacity(0.3), lineWidth: 1)
        )
    }

    private var durationSlider: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Duration")
                    .font(.subheadline)
                Spacer()
                Text("\(durationMinutes) minute\(durationMinutes == 1 ? "" : "s")")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.accentColor)
            }

            Slider(
                value: Binding(
                    get: { Double(durationMinutes) },
                    set: { durationMinutes = Int($0.rounded()) }
                ),
                in: 1...8,
                step: 1
            )
            .tint(.accentColor)

            HStack {
                Text("1 min")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("8 min")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var manualPositionSection: some View {
        VStack(spacing: 12) {
            Toggle("Manual position", isOn: $useManualPosition)

            if useManualPosition {
                TextField("Position ID", text: $manualPosition)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: useManualPosition)
    }

    private var infoPopoverContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Provider")
                    .font(.headline)
                Text("ElevenLabs generates quicker but is lower quality than Cartesia.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Duration")
                    .font(.headline)
                Text("This is approximate. A full \"chunk\" is ~8 minutes; adjusting the slider will take a proportion of the chunk.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("LLM Preprocessing")
                    .font(.headline)
                Text("This is the longest step, if switched on. More impactful for Cartesia, as it can insert pauses.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Manual Position")
                    .font(.headline)
                Text("Override the starting position. Use this to generate audio ahead of where you are, or to re-generate from a specific location.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .frame(width: 300)
        .presentationCompactAdaptation(.popover)
    }
}
