import SwiftUI

struct LibraryScreen: View {
    var audiobooks: [AudiobookEntry]
    var isLoading: Bool
    var onSelect: (AudiobookEntry) -> Void
    var onDelete: (AudiobookEntry) -> Void
    var onRefresh: () -> Void

    @State private var audiobookToDelete: AudiobookEntry?

    var body: some View {
        VStack(spacing: 0) {
            header

            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if audiobooks.isEmpty {
                Spacer()
                Text("No audiobooks generated yet")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                audiobooksList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .alert("Delete Audiobook?", isPresented: .init(
            get: { audiobookToDelete != nil },
            set: { if !$0 { audiobookToDelete = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                audiobookToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let entry = audiobookToDelete {
                    onDelete(entry)
                }
                audiobookToDelete = nil
            }
        } message: {
            if let entry = audiobookToDelete {
                Text("This will delete the audio for \"\(entry.bookTitle ?? entry.asin)\". You can regenerate it later.")
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Library")
                .font(.title2.bold())
                .frame(maxWidth: .infinity)

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.title3)
            }
            .padding(.trailing, 16)
        }
        .padding(.leading, 16)
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground))
    }

    private var audiobooksList: some View {
        List {
            ForEach(audiobooks) { entry in
                audiobookRow(entry)
                    .contentShape(Rectangle())
                    .onTapGesture { onSelect(entry) }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            audiobookToDelete = entry
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            onSelect(entry)
                        } label: {
                            Label("Play", systemImage: "play.fill")
                        }
                        .tint(.green)
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
        .listStyle(.plain)
    }

    private func audiobookRow(_ entry: AudiobookEntry) -> some View {
        HStack(spacing: 12) {
            if let coverURL = entry.coverImage, let url = URL(string: coverURL) {
                AsyncImage(url: url) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Color.gray.opacity(0.3)
                }
                .frame(width: 50, height: 75)
                .cornerRadius(6)
            } else {
                Image("GenericBook")
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 50, height: 75)
                    .cornerRadius(6)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.bookTitle ?? entry.asin)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)

                HStack {
                    HStack(spacing: 4) {
                        Image(systemName: "book")
                        Text(formatPositionRange(entry))
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "clock")
                        Text(formatDuration(entry.durationSeconds))
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Image(systemName: "waveform")
                        Text(entry.ttsProvider)
                    }
                }
                .lineLimit(1)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func formatPositionRange(_ entry: AudiobookEntry) -> String {
        let percent = Int(entry.startPercent)
        let startK = Double(entry.audioStartPositionId) / 1000.0
        let endK = Double(entry.audioEndPositionId) / 1000.0
        return String(format: "%d%% (%.1fk–%.1fk)", percent, startK, endK)
    }

    private func formatDuration(_ seconds: Double) -> String {
        let minutes = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", minutes, secs)
    }
}
