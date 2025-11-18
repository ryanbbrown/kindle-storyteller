import type { KindleBook, KindleBookDetails } from "kindle-api";

export type SerializedKindleBook = {
  asin: string;
  title: string;
  authors: KindleBook["authors"];
  imageUrl: string;
  originType: string;
  resourceType: string;
  mangaOrComicAsin: boolean;
  webReaderUrl: string;
};

export type SerializedBookDetails = {
  title: string;
  coverImage: string;
  currentPosition: number;
  length: number;
};

export function serializeBook(book: KindleBook): SerializedKindleBook {
  return {
    asin: book.asin,
    title: book.title,
    authors: book.authors,
    imageUrl: book.imageUrl,
    originType: book.originType,
    resourceType: book.resourceType,
    mangaOrComicAsin: book.mangaOrComicAsin,
    webReaderUrl: book.webReaderUrl,
  };
}

export function serializeBooks(books: KindleBook[]): SerializedKindleBook[] {
  return books.map(serializeBook);
}

export function serializeBookDetails(details: KindleBookDetails): SerializedBookDetails {
  return {
    title: details.title,
    coverImage: details.largeCoverUrl,
    currentPosition: details.progress.position,
    length: details.endPosition,
  };
}
