import SwiftUI

struct HomeScreen: View {
    var onConnectKindle: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image("GenericBook")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 160, height: 240)
                .cornerRadius(12)
                .shadow(radius: 8)

            Button(action: onConnectKindle) {
                Text("Connect Kindle")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 40)

            Text("Select a book from your Kindle library to generate an audiobook")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
