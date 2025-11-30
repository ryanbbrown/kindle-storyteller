import SwiftUI

struct AudioSettingsScreen: View {
    var bookDetails: BookDetails?
    @Binding var selectedProvider: String
    @Binding var llmPreprocessing: Bool
    @Binding var placeholderToggle1: Bool
    @Binding var placeholderToggle2: Bool
    var onGenerate: () -> Void

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
            Text("Audio Settings")
                .font(.title2.bold())

            providerPicker

            VStack(spacing: 16) {
                Toggle("LLM preprocessing", isOn: $llmPreprocessing)
                Toggle("Include chapter breaks", isOn: $placeholderToggle1)
                Toggle("Normalize audio", isOn: $placeholderToggle2)
            }

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
}
