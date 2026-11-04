import { Canvas } from '@react-three/fiber';

export default function App() {
  return (
    <div className="app">
      <Canvas camera={{ position: [0, 2, 5] }}>
        <ambientLight intensity={0.2} />
        <pointLight position={[5, 3, 5]} intensity={60} />
        <mesh>
          <sphereGeometry args={[1, 48, 24]} />
          <meshStandardMaterial color="#4a7fd4" />
        </mesh>
      </Canvas>
      <div className="placeholder">KSP Map: scaffold</div>
    </div>
  );
}
