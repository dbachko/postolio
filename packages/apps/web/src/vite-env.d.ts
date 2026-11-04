/// <reference types="vite/client" />

interface ErrorConstructor {
  captureStackTrace?(targetObject: object, constructorOpt?: object): void;
}
