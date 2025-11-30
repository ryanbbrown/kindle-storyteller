import SwiftUI

struct TabBar: View {
    @Binding var selectedTab: AppScreen

    var body: some View {
        HStack(spacing: 0) {
            tabButton(icon: "link", label: "Connect", tab: .home)
            tabButton(icon: "waveform.badge.plus", label: "Generate", tab: .audioSettings)
            tabButton(icon: "play.circle", label: "Listen", tab: .player)
            tabButton(icon: "books.vertical", label: "Library", tab: .library)
        }
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground))
    }

    private func tabButton(icon: String, label: String, tab: AppScreen) -> some View {
        Button(action: { selectedTab = tab }) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.title2)
                Text(label)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .foregroundColor(selectedTab == tab ? .accentColor : .primary)
        }
    }
}
