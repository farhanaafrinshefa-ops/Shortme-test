import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { TimelineSegment } from '../../types';

interface TimelineProps {
  duration: number; // Total duration in seconds
  currentTime: number;
  segments: TimelineSegment[];
  onSeek: (time: number) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ duration, currentTime, segments, onSeek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = 80;
    const pixelsPerSecond = 20;
    const totalWidth = Math.max(width, duration * pixelsPerSecond);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", totalWidth)
       .attr("height", height);

    // Scale
    const xScale = d3.scaleLinear()
      .domain([0, duration])
      .range([0, totalWidth]);

    // Draw background track
    svg.append("rect")
      .attr("width", totalWidth)
      .attr("height", 40)
      .attr("y", 20)
      .attr("fill", "rgba(255,255,255,0.05)")
      .attr("rx", 4);

    // Draw Segments
    segments.forEach(seg => {
      svg.append("rect")
        .attr("x", xScale(seg.startTime))
        .attr("width", xScale(seg.endTime) - xScale(seg.startTime))
        .attr("y", 22)
        .attr("height", 36)
        .attr("fill", seg.type === 'video' ? '#6366f1' : '#ec4899') // Indigo or Pink
        .attr("rx", 4)
        .attr("opacity", 0.6)
        .attr("stroke", "rgba(255,255,255,0.2)")
        .attr("stroke-width", 1);
    });

    // Time ticks
    const axis = d3.axisBottom(xScale)
      .ticks(Math.floor(duration / 5)) // Tick every 5 seconds roughly
      .tickFormat(d => {
        const min = Math.floor(d.valueOf() / 60);
        const sec = Math.floor(d.valueOf() % 60);
        return `${min}:${sec.toString().padStart(2, '0')}`;
      })
      .tickSize(5);

    svg.append("g")
      .attr("transform", `translate(0, 60)`)
      .call(axis)
      .attr("color", "rgba(255,255,255,0.3)")
      .select(".domain").remove();

    // Click to seek
    svg.on("click", (event) => {
      const [x] = d3.pointer(event);
      const clickedTime = xScale.invert(x);
      onSeek(Math.min(Math.max(0, clickedTime), duration));
    });

  }, [duration, segments, onSeek]); // Re-draw when segments change

  // Auto scroll logic could go here, but omitted for simplicity
  
  return (
    <div className="w-full overflow-x-auto no-scrollbar relative" ref={containerRef}>
      <svg ref={svgRef} className="block" />
      
      {/* Playhead - Fixed to center or moving? Moving for this simple implementation */}
      <div 
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_white] z-20 pointer-events-none transition-all duration-100 ease-linear"
        style={{ 
          left: `${(currentTime / duration) * (Math.max(containerRef.current?.clientWidth || 0, duration * 20))}px` 
        }}
      >
        <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-white transform rotate-45" />
      </div>
    </div>
  );
};